import { TZDate } from "@date-fns/tz";
import { and, eq } from "drizzle-orm";
import { driverAbsences, drivers, fleetTerms, trailers, vehicles, type TermKind } from "@/db/schema";
import type { Executor } from "@/db/types";
import { createRng, seedFromString } from "@/simulation/random";
import { ABSENCES, SERVICE_INTERVAL_KM, TERM_OVERRIDES } from "@/simulation/scenario/fleet-file";
import { registerSeedExtension } from "../sandbox/repository";

const DAY = 86_400_000;

/** Midnight (Warsaw) of the demo day plus `days`. */
export function dayStart(origin: Date, days: number): Date {
  const local = new TZDate(origin.getTime(), "Europe/Warsaw");
  return new Date(new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + days, 0, 0, "Europe/Warsaw").getTime());
}

/** Deadlines and absences for a world, deterministic per world seed. */
export async function seedFleetFile(db: Executor, sandboxId: string, origin: Date, seed: number) {
  const existing = await db.select({ id: fleetTerms.id }).from(fleetTerms).where(eq(fleetTerms.sandboxId, sandboxId));
  if (existing.length > 0) return;
  const [vs, ts, ds] = await Promise.all([
    db.select().from(vehicles).where(eq(vehicles.sandboxId, sandboxId)),
    db.select().from(trailers).where(eq(trailers.sandboxId, sandboxId)),
    db.select().from(drivers).where(eq(drivers.sandboxId, sandboxId)),
  ]);
  const rows: (typeof fleetTerms.$inferInsert)[] = [];
  const term = (subjectType: "vehicle" | "trailer" | "driver", subjectId: string, kind: TermKind, blocking: boolean, odometer: number | null, interval = 0) => {
    const override = TERM_OVERRIDES.find((o) => o.subjectId === subjectId && o.kind === kind);
    const rng = createRng(seed ^ seedFromString(`${subjectId}:${kind}`));
    const days = override?.days ?? rng.int(45, 420);
    const isKm = kind === "serwis";
    rows.push({
      sandboxId,
      id: `${subjectId}:${kind}`,
      subjectType,
      subjectId,
      kind,
      dueSim: isKm ? null : new Date(origin.getTime() + days * DAY),
      dueKm: isKm && odometer !== null ? odometer + (override?.kmLeft ?? rng.int(8_000, Math.max(9_000, interval - 5_000))) : null,
      docNumber: isKm ? "" : `${kind.toUpperCase().slice(0, 3)}/${rng.int(10_000, 99_999)}`,
      blocking,
    });
  };
  for (const v of vs) {
    term("vehicle", v.id, "przeglad", true, null);
    term("vehicle", v.id, "oc", true, null);
    if (v.subjectTo561) term("vehicle", v.id, "tachograf", true, null);
    term("vehicle", v.id, "serwis", false, v.odometerKm, SERVICE_INTERVAL_KM[v.kind]);
  }
  for (const t of ts) {
    term("trailer", t.id, "przeglad", true, null);
    if (t.body === "chlodnia") term("trailer", t.id, "atp", true, null);
  }
  for (const d of ds) {
    term("driver", d.id, "prawo_jazdy", true, null);
    term("driver", d.id, "kwalifikacja", true, null);
    term("driver", d.id, "karta_kierowcy", true, null);
    term("driver", d.id, "badania", true, null);
    if (d.adrCertificate) term("driver", d.id, "adr", false, null);
  }
  await db.insert(fleetTerms).values(rows);
  await db.insert(driverAbsences).values(
    ABSENCES.map((a, i) => ({
      sandboxId,
      id: `abs-${i + 1}`,
      driverId: a.driverId,
      kind: a.kind,
      fromSim: dayStart(origin, a.fromDay),
      toSim: dayStart(origin, a.fromDay + a.days),
      note: a.note,
    })),
  );
}

registerSeedExtension(async (db, sandbox) => {
  await seedFleetFile(db, sandbox.id, sandbox.simOrigin, sandbox.seed);
});

export async function ensureFleetFile(db: Executor, sandbox: { id: string; simOrigin: Date; seed: number }) {
  const [one] = await db.select({ id: fleetTerms.id }).from(fleetTerms).where(and(eq(fleetTerms.sandboxId, sandbox.id)));
  if (!one) await seedFleetFile(db, sandbox.id, sandbox.simOrigin, sandbox.seed);
}
