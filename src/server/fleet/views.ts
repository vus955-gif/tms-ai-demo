import { TZDate } from "@date-fns/tz";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { driverAbsences, drivers, fleetTerms, orders, trailers, vehicles, type AbsenceKind, type TermKind } from "@/db/schema";
import type { Executor } from "@/db/types";
import { ABSENCE_LABEL, renewTerm, TERM_LABEL, termStatus, type TermStatus } from "@/domain/fleet-terms";
import { SERVICE_INTERVAL_KM } from "@/simulation/scenario/fleet-file";
import { HttpError } from "../http";
import { dayStart, ensureFleetFile } from "./seed";

export type TermView = { id: string; kind: TermKind; label: string; status: TermStatus; dueSim: string | null; dueKm: number | null; kmLeft: number | null; docNumber: string; blocking: boolean };
export type SubjectView = { id: string; type: "vehicle" | "trailer" | "driver"; title: string; subtitle: string; odometerKm: number | null; terms: TermView[]; worst: TermStatus };
export type FleetFileView = { vehicles: SubjectView[]; trailers: SubjectView[]; drivers: SubjectView[]; overdue: number; soon: number };

const RANK: Record<TermStatus, number> = { po_terminie: 0, wkrotce: 1, ok: 2 };

export async function fleetFile(db: Executor, sandbox: { id: string; simOrigin: Date; seed: number }, simNow: Date): Promise<FleetFileView> {
  await ensureFleetFile(db, sandbox);
  const [terms, vs, ts, ds] = await Promise.all([
    db.select().from(fleetTerms).where(eq(fleetTerms.sandboxId, sandbox.id)),
    db.select().from(vehicles).where(eq(vehicles.sandboxId, sandbox.id)),
    db.select().from(trailers).where(eq(trailers.sandboxId, sandbox.id)),
    db.select().from(drivers).where(eq(drivers.sandboxId, sandbox.id)),
  ]);
  const view = (type: SubjectView["type"], id: string, title: string, subtitle: string, odometerKm: number | null): SubjectView => {
    const own = terms
      .filter((t) => t.subjectId === id)
      .map((t) => {
        const status = termStatus(t, simNow, odometerKm);
        return {
          id: t.id,
          kind: t.kind,
          label: TERM_LABEL[t.kind],
          status,
          dueSim: t.dueSim?.toISOString() ?? null,
          dueKm: t.dueKm,
          kmLeft: t.dueKm !== null && odometerKm !== null ? t.dueKm - odometerKm : null,
          docNumber: t.docNumber,
          blocking: t.blocking,
        };
      })
      .sort((a, b) => RANK[a.status] - RANK[b.status]);
    return { id, type, title, subtitle, odometerKm, terms: own, worst: own[0]?.status ?? "ok" };
  };
  const driverOf = (vehicleId: string) => ds.find((d) => d.vehicleId === vehicleId);
  const list = {
    vehicles: vs.map((v) => view("vehicle", v.id, v.plates, `${v.kind === "bus" ? "bus" : v.kind === "solo" ? "solówka" : "ciągnik"} · ${driverOf(v.id) ? `${driverOf(v.id)!.firstName} ${driverOf(v.id)!.lastName}` : "bez kierowcy"}`, v.odometerKm)),
    trailers: ts.map((t) => view("trailer", t.id, t.plates, `naczepa ${t.body === "chlodnia" ? "chłodnia" : t.body}${t.adr ? " · ADR" : ""}`, null)),
    drivers: ds.map((d) => view("driver", d.id, `${d.firstName} ${d.lastName}`, vs.find((v) => v.id === d.vehicleId)?.plates ?? "", null)),
  };
  const all = [...list.vehicles, ...list.trailers, ...list.drivers].flatMap((s) => s.terms);
  const byWorst = (a: SubjectView, b: SubjectView) => RANK[a.worst] - RANK[b.worst] || a.title.localeCompare(b.title, "pl");
  return {
    vehicles: list.vehicles.sort(byWorst),
    trailers: list.trailers.sort(byWorst),
    drivers: list.drivers.sort(byWorst),
    overdue: all.filter((t) => t.status === "po_terminie").length,
    soon: all.filter((t) => t.status === "wkrotce").length,
  };
}

/** "Odnotuj wykonanie": the work was done today — next deadline from the renewal rules. */
export async function renewFleetTerm(db: Executor, sandboxId: string, termId: string, simNow: Date) {
  const [t] = await db.select().from(fleetTerms).where(and(eq(fleetTerms.sandboxId, sandboxId), eq(fleetTerms.id, termId)));
  if (!t) throw new HttpError(404, "Nie ma takiego terminu.");
  const [v] = t.subjectType === "vehicle" ? await db.select().from(vehicles).where(and(eq(vehicles.sandboxId, sandboxId), eq(vehicles.id, t.subjectId))) : [];
  const next = renewTerm(t, simNow, v?.odometerKm ?? 0, v ? SERVICE_INTERVAL_KM[v.kind] : 0);
  await db.update(fleetTerms).set({ ...next, doneSim: simNow }).where(and(eq(fleetTerms.sandboxId, sandboxId), eq(fleetTerms.id, termId)));
}

export async function fleetAttentionCount(db: Executor, sandbox: { id: string; simOrigin: Date; seed: number }, simNow: Date): Promise<number> {
  const f = await fleetFile(db, sandbox, simNow);
  return f.overdue + f.soon;
}

// ——— Driver calendar ———

export type CalendarView = {
  days: string[];
  drivers: {
    id: string;
    name: string;
    plates: string;
    absences: { id: string; kind: AbsenceKind; label: string; from: string; to: string; note: string }[];
    orders: { id: string; number: string; status: string; from: string; to: string }[];
  }[];
};

export async function driverCalendar(db: Executor, sandbox: { id: string; simOrigin: Date; seed: number }, simNow: Date, offsetDays = 0): Promise<CalendarView> {
  await ensureFleetFile(db, sandbox);
  const start = dayStart(simNow, offsetDays);
  const end = new Date(dayStart(simNow, offsetDays + 7).getTime());
  const [ds, vs, abs, ords] = await Promise.all([
    db.select().from(drivers).where(eq(drivers.sandboxId, sandbox.id)),
    db.select().from(vehicles).where(eq(vehicles.sandboxId, sandbox.id)),
    db.select().from(driverAbsences).where(eq(driverAbsences.sandboxId, sandbox.id)),
    db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), inArray(orders.status, ["PRZYPISANE", "WYSLANE", "POTWIERDZONE", "ZALADUNEK", "W_DRODZE", "ROZLADUNEK"]))),
  ]);
  const overlaps = (from: Date, to: Date) => from < end && to > start;
  return {
    days: Array.from({ length: 7 }, (_, i) => dayStart(simNow, offsetDays + i).toISOString()),
    drivers: ds
      .map((d) => ({
        id: d.id,
        name: `${d.firstName} ${d.lastName}`,
        plates: vs.find((v) => v.id === d.vehicleId)?.plates ?? "",
        absences: abs
          .filter((a) => a.driverId === d.id && overlaps(a.fromSim, a.toSim))
          .map((a) => ({ id: a.id, kind: a.kind, label: ABSENCE_LABEL[a.kind], from: a.fromSim.toISOString(), to: a.toSim.toISOString(), note: a.note })),
        orders: ords
          .filter((o) => o.driverId === d.id && overlaps(o.pickupFrom, o.deliveryTo))
          .map((o) => ({ id: o.id, number: o.number, status: o.status, from: o.pickupFrom.toISOString(), to: o.deliveryTo.toISOString() })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pl")),
  };
}

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const warsawDay = (value: string, plusDays = 0) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(new TZDate(y, m - 1, d + plusDays, 0, 0, "Europe/Warsaw").getTime());
};

export async function addAbsence(db: Executor, sandboxId: string, input: { driverId: string; kind: AbsenceKind; from: string; to: string; note: string }) {
  if (!ymd.test(input.from) || !ymd.test(input.to)) throw new HttpError(400, "Podaj daty w formacie RRRR-MM-DD.");
  const from = warsawDay(input.from);
  const to = warsawDay(input.to, 1);
  if (to <= from) throw new HttpError(400, "Koniec nieobecności nie może być przed początkiem.");
  if (to.getTime() - from.getTime() > 60 * 86_400_000) throw new HttpError(400, "Najwyżej 60 dni naraz.");
  const [driver] = await db.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.sandboxId, sandboxId), eq(drivers.id, input.driverId)));
  if (!driver) throw new HttpError(404, "Nie ma takiego kierowcy.");
  const id = randomUUID();
  await db.insert(driverAbsences).values({ sandboxId, id, driverId: input.driverId, kind: input.kind, fromSim: from, toSim: to, note: input.note.slice(0, 200) });
  return id;
}

export async function removeAbsence(db: Executor, sandboxId: string, id: string) {
  const res = await db.delete(driverAbsences).where(and(eq(driverAbsences.sandboxId, sandboxId), eq(driverAbsences.id, id))).returning({ id: driverAbsences.id });
  if (res.length === 0) throw new HttpError(404, "Nie ma takiej nieobecności.");
}
