import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { clients, drivers, orders, orderTemplates, points } from "@/db/schema";
import type { Executor } from "@/db/types";
import { uniqueViolation } from "@/db/errors";
import { forecastState, plannedDays, runOn, smsTimeFor, warsawDate, type ForecastState, type PlannedDay } from "@/domain/recurring";
import { advisePlanRun } from "@/ai/functions/plan-advice";
import type { AdviceCandidate, AdviceFacts } from "@/domain/plan-advice";
import { templatesSeed } from "@/simulation/scenario/templates";
import { HttpError } from "../http";
import { assignOrder } from "../orders/assign";
import { assertAssignable, loadMatchContext, matchVirtual, type MatchContext, type MatchView } from "../orders/board";
import { createOrder } from "../orders/create";
import { registerSeedExtension } from "../sandbox/repository";

type TemplateRow = typeof orderTemplates.$inferSelect;

/** A public demo: enough for a realistic plan, not enough to make the weekly forecast heavy. */
export const MAX_TEMPLATES = 20;
/** Days ahead the plan covers (starting tomorrow). */
const PLAN_DAYS = 7;

export async function seedTemplates(db: Executor, sandboxId: string, simNow: Date) {
  const existing = await db.select({ id: orderTemplates.id }).from(orderTemplates).where(eq(orderTemplates.sandboxId, sandboxId));
  if (existing.length > 0) return;
  await db
    .insert(orderTemplates)
    .values(templatesSeed.map((t) => ({ sandboxId, ...t, adrRequired: false, active: true, createdSim: simNow })))
    .onConflictDoNothing();
}

registerSeedExtension(async (db, sandbox) => {
  await seedTemplates(db, sandbox.id, sandbox.simOrigin);
});

export type TemplateView = TemplateRow & { clientName: string; route: string };

export async function listTemplates(db: Executor, sandbox: { id: string; simOrigin: Date }): Promise<TemplateView[]> {
  const [rows, cls, pts] = await Promise.all([
    db.select().from(orderTemplates).where(eq(orderTemplates.sandboxId, sandbox.id)),
    db.select().from(clients).where(eq(clients.sandboxId, sandbox.id)),
    db.select().from(points).where(eq(points.sandboxId, sandbox.id)),
  ]);
  // Worlds created before stage 4 get the examples once; deleted templates stay (archived), so an emptied list stays empty.
  if (rows.length === 0) {
    await seedTemplates(db, sandbox.id, sandbox.simOrigin);
    return listTemplates(db, sandbox);
  }
  const city = (id: string) => pts.find((p) => p.id === id)?.city ?? id;
  return rows
    .filter((t) => !t.archived)
    .map((t) => ({ ...t, clientName: cls.find((c) => c.id === t.clientId)?.name ?? "", route: `${city(t.pickupPointId)} → ${city(t.deliveryPointId)}` }))
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));
}

export type PlannedOrder = {
  key: string;
  templateId: string;
  templateName: string;
  date: string;
  pickupFrom: string;
  pickupTo: string;
  deliveryFrom: string;
  deliveryTo: string;
  orderNumber: string | null;
  forecast: ForecastState;
  bestDriver: string | null;
  bestPlates: string | null;
  reason: string;
  /** The template's usual driver and whether they can take this run. */
  defaultDriver: { name: string; plates: string; ok: boolean; reason: string } | null;
  /** Creating the order assigns it to the usual driver (SMS the day before). */
  assignsDefault: boolean;
};

const planKey = (templateId: string, date: string) => `${templateId}:${date}`;

/** Orders already made from templates; a cancelled one frees its day again. */
async function liveTemplateOrders(db: Executor, sandboxId: string) {
  return db
    .select({ key: orders.templateKey, number: orders.number })
    .from(orders)
    .where(and(eq(orders.sandboxId, sandboxId), isNotNull(orders.templateKey), ne(orders.status, "ANULOWANE")));
}

async function evaluateRun(db: Executor, sandboxId: string, t: TemplateView, day: PlannedDay, simNow: Date, ctx: MatchContext) {
  const results = await matchVirtual(
    db,
    sandboxId,
    {
      id: planKey(t.id, day.date),
      clientId: t.clientId,
      pickupPointId: t.pickupPointId,
      deliveryPointId: t.deliveryPointId,
      pickupFrom: day.pickupFrom,
      pickupTo: day.pickupTo,
      deliveryFrom: day.deliveryFrom,
      deliveryTo: day.deliveryTo,
      cargoPallets: t.cargoPallets,
      cargoKg: t.cargoKg,
      bodyRequired: t.bodyRequired,
      adrRequired: t.adrRequired,
    },
    simNow,
    ctx,
  );
  const windows = { pickupToMs: day.pickupTo.getTime(), deliveryToMs: day.deliveryTo.getTime() };
  const usual = t.defaultDriverId ? results.find((r) => r.driverId === t.defaultDriverId) : undefined;
  const usualOk = Boolean(usual && usual.tier !== "excluded");
  const best = results.find((r) => r.tier !== "excluded");
  // The usual driver drives when they can; otherwise the forecast is for the best one.
  const chosen = usualOk ? usual : best;
  const dropped = results.filter((r) => r.tier === "excluded");
  // Vehicles that fit the load but are out for now (deadline, absence, too far) say what to fix.
  const fixable = dropped.filter((r) => !r.hard).map((r) => `${r.plates}: ${r.reasons[0]}`);
  const hard = [...new Set(dropped.filter((r) => r.hard).map((r) => r.reasons[0]))];
  return { results, windows, usual, usualOk, chosen, fixable, hard, state: forecastState(chosen, windows) };
}

/**
 * Next week's recurring orders with a timeliness forecast from the same
 * matching as "klocki". Each order is forecast on its own (a driver can show up
 * as the best fit for two orders of one day).
 */
export async function weekPlan(db: Executor, sandbox: { id: string; simOrigin: Date }, simNow: Date, loaded?: TemplateView[]): Promise<PlannedOrder[]> {
  const templates = (loaded ?? (await listTemplates(db, sandbox))).filter((t) => t.active);
  const [existing, ctx] = await Promise.all([liveTemplateOrders(db, sandbox.id), loadMatchContext(db, sandbox.id)]);
  const out: PlannedOrder[] = [];
  for (const t of templates) {
    for (const day of plannedDays(t, simNow, PLAN_DAYS)) {
      const key = planKey(t.id, day.date);
      const e = await evaluateRun(db, sandbox.id, t, day, simNow, ctx);
      out.push({
        key,
        templateId: t.id,
        templateName: t.name,
        date: day.date,
        pickupFrom: day.pickupFrom.toISOString(),
        pickupTo: day.pickupTo.toISOString(),
        deliveryFrom: day.deliveryFrom.toISOString(),
        deliveryTo: day.deliveryTo.toISOString(),
        orderNumber: existing.find((x) => x.key === key)?.number ?? null,
        forecast: e.state,
        bestDriver: e.chosen?.driverName ?? null,
        bestPlates: e.chosen?.plates ?? null,
        reason: e.chosen
          ? e.chosen.reasons.slice(0, 2).join(" · ")
          : e.fixable.length > 0
            ? e.fixable.slice(0, 2).join("; ")
            : e.hard.length > 0
              ? `brak pojazdu: ${e.hard.slice(0, 2).join("; ")}`
              : "brak pojazdów we flocie",
        defaultDriver: e.usual ? { name: e.usual.driverName, plates: e.usual.plates, ok: e.usualOk, reason: e.usualOk ? "" : (e.usual.reasons[0] ?? "") } : null,
        assignsDefault: e.usualOk,
      });
    }
  }
  return out.sort((a, b) => a.pickupFrom.localeCompare(b.pickupFrom));
}

export type PlanSkip = { key: string; reason: string };
/** `smsNow`: the order SMS went out right away (16:00 the day before had already passed, or "od razu"). */
export type PlanCreated = { number: string; driverName: string | null; smsAt: string | null; smsNow: boolean; notAssigned: string | null };
export type PlanItem = { key: string; driverId?: string | null };
/** "dzien_przed": order SMS at 16:00 the day before the run; "od_razu": now. */
export type SmsMode = "dzien_przed" | "od_razu";

/**
 * One click: the selected planned orders become NOWE orders. A key is resolved
 * from its own date (not from a fresh plan), so a selection made just before
 * midnight still works; the database guarantees one live order per template and day.
 */
export async function createPlanned(
  db: Executor,
  sandbox: { id: string; simOrigin: Date },
  items: (string | PlanItem)[],
  simNow: Date,
  opts: { sms: SmsMode } = { sms: "dzien_przed" },
): Promise<{ created: PlanCreated[]; skipped: PlanSkip[] }> {
  const [templates, existing] = await Promise.all([listTemplates(db, sandbox), liveTemplateOrders(db, sandbox.id)]);
  const today = warsawDate(simNow);
  const lastDay = warsawDate(simNow, PLAN_DAYS);
  const created: PlanCreated[] = [];
  const skipped: PlanSkip[] = [];
  const unique = [...new Map(items.map((i) => (typeof i === "string" ? { key: i } : i)).map((i) => [i.key, i])).values()];
  for (const { key, driverId: pickedDriver } of unique) {
    const cut = key.lastIndexOf(":");
    const [templateId, date] = [key.slice(0, cut), key.slice(cut + 1)];
    const t = templates.find((x) => x.id === templateId);
    if (!t || !t.active) {
      skipped.push({ key, reason: "szablon usunięty albo wstrzymany" });
      continue;
    }
    const run = runOn(t, date);
    if (!run || date < today || date > lastDay) {
      skipped.push({ key, reason: "dzień poza paczką" });
      continue;
    }
    if (run.pickupTo <= simNow) {
      skipped.push({ key, reason: "okno załadunku już minęło" });
      continue;
    }
    const made = existing.find((e) => e.key === key);
    if (made) {
      skipped.push({ key, reason: `już utworzone (${made.number})` });
      continue;
    }
    try {
      const result = await (db as Executor).transaction(async (tx) => {
        const order = await createOrder(
          tx,
          sandbox.id,
          {
            clientId: t.clientId,
            pickupPointId: t.pickupPointId,
            deliveryPointId: t.deliveryPointId,
            pickupFrom: run.pickupFrom.toISOString(),
            pickupTo: run.pickupTo.toISOString(),
            deliveryFrom: run.deliveryFrom.toISOString(),
            deliveryTo: run.deliveryTo.toISOString(),
            cargoPallets: t.cargoPallets,
            cargoKg: t.cargoKg,
            bodyRequired: t.bodyRequired,
            adrRequired: t.adrRequired,
            references: [...t.references, date.slice(5).replace("-", "")].slice(0, 5),
            notes: t.notes,
          },
          { simNow, source: "template", actor: "dispatcher", reason: `Zlecenie stałe: ${t.name}`, templateKey: key },
        );
        // A driver picked in the advisor, else the template's usual one — only if they still fit.
        const driverId = pickedDriver ?? t.defaultDriverId;
        if (!driverId) return { number: order.number, driverName: null, smsAt: null, smsNow: false, notAssigned: null };
        const notAssigned = (reason: string) => ({ number: order.number, driverName: null, smsAt: null, smsNow: false, notAssigned: reason });
        try {
          await assertAssignable(tx, sandbox.id, order.id, driverId, simNow);
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          return notAssigned(error.message.replace(/^Tego zlecenia nie można przydzielić: /, "").replace(/\.$/, ""));
        }
        // Matching plans only confirmed runs: a run assigned a moment ago (this pack, SMS not out yet) must not overlap.
        const clash = await tx
          .select({ number: orders.number })
          .from(orders)
          .where(and(eq(orders.sandboxId, sandbox.id), eq(orders.driverId, driverId), inArray(orders.status, ["PRZYPISANE", "WYSLANE"]), lt(orders.pickupFrom, run.deliveryTo), gt(orders.deliveryTo, run.pickupFrom)));
        if (clash.length) return notAssigned(`kierowca ma już w tym czasie ${clash[0].number}`);
        const dayBefore = smsTimeFor(date);
        const smsAt = opts.sms === "dzien_przed" && dayBefore && dayBefore > simNow ? dayBefore : simNow;
        await assignOrder(tx, sandbox.id, order.id, driverId, { actor: "dispatcher", simNow, smsAt });
        const [d] = await tx.select({ first: drivers.firstName, last: drivers.lastName }).from(drivers).where(and(eq(drivers.sandboxId, sandbox.id), eq(drivers.id, driverId)));
        return { number: order.number, driverName: d ? `${d.first} ${d.last}` : null, smsAt: smsAt.toISOString(), smsNow: smsAt.getTime() === simNow.getTime(), notAssigned: null };
      });
      created.push(result);
    } catch (error) {
      const constraint = uniqueViolation(error);
      if (constraint === null) throw error;
      // Another tab or a double click got there first (same day, or the same order number at the same moment).
      skipped.push({ key, reason: constraint === "orders_template_key_uq" ? "już utworzone" : "utworzone równolegle w innej karcie — odśwież i spróbuj ponownie" });
    }
  }
  return { created, skipped };
}

const minutes = (label: string, max: number) =>
  z
    .number({ error: `${label}: podaj godzinę` })
    .int(`${label}: podaj godzinę`)
    .min(0, `${label}: podaj godzinę`)
    .max(max, `${label}: podaj godzinę`);

export const TemplateInputSchema = z
  .object({
    name: z.string().trim().min(3, "Nazwa: co najmniej 3 znaki").max(80, "Nazwa: najwyżej 80 znaków"),
    clientId: z.string().min(1, "Wybierz klienta").max(64),
    pickupPointId: z.string().min(1, "Wybierz punkt załadunku").max(64),
    deliveryPointId: z.string().min(1, "Wybierz punkt rozładunku").max(64),
    pickupFromMin: minutes("Załadunek od", 1439),
    pickupToMin: minutes("Załadunek do", 1440),
    deliveryDayOffset: z.number().int().min(0).max(3),
    deliveryFromMin: minutes("Rozładunek od", 1439),
    deliveryToMin: minutes("Rozładunek do", 1440),
    cargoPallets: z.number({ error: "Palety: podaj liczbę" }).int("Palety: liczba całkowita").min(1, "Palety: co najmniej 1").max(33, "Palety: najwyżej 33"),
    cargoKg: z.number({ error: "Waga: podaj liczbę" }).int("Waga: w pełnych kilogramach").min(1, "Waga: co najmniej 1 kg").max(24000, "Waga: najwyżej 24 000 kg"),
    bodyRequired: z.enum(["plandeka", "chlodnia", "skrzynia"]).nullable(),
    adrRequired: z.boolean(),
    references: z.array(z.string().max(40, "Referencja: najwyżej 40 znaków")).max(4, "Najwyżej 4 referencje"),
    notes: z.string().max(300, "Uwagi: najwyżej 300 znaków"),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Wybierz co najmniej jeden dzień").max(7),
    defaultDriverId: z.string().max(64).nullable().default(null),
  })
  .refine((t) => t.pickupFromMin < t.pickupToMin, { message: "Okno załadunku musi kończyć się po rozpoczęciu" })
  .refine((t) => t.deliveryFromMin < t.deliveryToMin, { message: "Okno rozładunku musi kończyć się po rozpoczęciu" })
  .refine((t) => t.deliveryDayOffset > 0 || t.deliveryToMin > t.pickupFromMin, { message: "Rozładunek nie może kończyć się przed załadunkiem" })
  .refine((t) => t.pickupPointId !== t.deliveryPointId, { message: "Załadunek i rozładunek muszą być w różnych punktach" });

const live = (sandboxId: string, id: string) => and(eq(orderTemplates.sandboxId, sandboxId), eq(orderTemplates.id, id), eq(orderTemplates.archived, false));

export async function saveTemplate(db: Executor, sandboxId: string, input: z.input<typeof TemplateInputSchema>, simNow: Date, id?: string) {
  const own = await db.select({ id: points.id }).from(points).where(and(eq(points.sandboxId, sandboxId), eq(points.clientId, input.clientId)));
  if (![input.pickupPointId, input.deliveryPointId].every((p) => own.some((x) => x.id === p))) throw new HttpError(400, "Punkt nie należy do wybranego klienta.");
  if (input.defaultDriverId) {
    const [d] = await db.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.sandboxId, sandboxId), eq(drivers.id, input.defaultDriverId)));
    if (!d) throw new HttpError(400, "Nie ma takiego kierowcy.");
  }
  const values = { ...input, weekdays: [...new Set(input.weekdays)].sort() };
  if (id) {
    const res = await db.update(orderTemplates).set(values).where(live(sandboxId, id)).returning({ id: orderTemplates.id });
    if (res.length === 0) throw new HttpError(404, "Nie ma takiego szablonu.");
    return id;
  }
  const [{ n }] = await db
    .select({ n: count() })
    .from(orderTemplates)
    .where(and(eq(orderTemplates.sandboxId, sandboxId), eq(orderTemplates.archived, false)));
  if (n >= MAX_TEMPLATES) throw new HttpError(400, `W demo można mieć najwyżej ${MAX_TEMPLATES} szablonów — usuń któryś niepotrzebny.`);
  const newId = `tpl-${randomUUID().slice(0, 8)}`;
  await db.insert(orderTemplates).values({ sandboxId, id: newId, ...values, active: true, createdSim: simNow });
  return newId;
}

export async function setTemplateActive(db: Executor, sandboxId: string, id: string, active: boolean) {
  const res = await db.update(orderTemplates).set({ active }).where(live(sandboxId, id)).returning({ id: orderTemplates.id });
  if (res.length === 0) throw new HttpError(404, "Nie ma takiego szablonu.");
}

/** Removes a template from the list; orders already created from it stay. */
export async function deleteTemplate(db: Executor, sandboxId: string, id: string) {
  const res = await db.update(orderTemplates).set({ archived: true, active: false }).where(live(sandboxId, id)).returning({ id: orderTemplates.id });
  if (res.length === 0) throw new HttpError(404, "Nie ma takiego szablonu.");
}

const asCandidate = (r: MatchView, windows: { pickupToMs: number; deliveryToMs: number }): AdviceCandidate => {
  const slack = (eta: number | null | undefined, to: number) => (eta == null ? null : Math.round((to - eta) / 60_000));
  return {
    driverId: r.driverId,
    name: r.driverName,
    plates: r.plates,
    forecast: forecastState(r, windows) === "zdazy" ? "zdazy" : "ryzyko",
    slackPickupMin: slack(r.pickupEtaMs, windows.pickupToMs),
    slackDeliveryMin: slack(r.deliveryEtaMs, windows.deliveryToMs),
    reasons: r.reasons.slice(0, 3),
  };
};

/** "Doradź" for one planned run: the algorithm's candidates and obstacles, explained by AI (rules without it). */
export async function adviseRun(db: Executor, sandbox: { id: string; simOrigin: Date }, key: string, simNow: Date) {
  const cut = key.lastIndexOf(":");
  const [templateId, date] = [key.slice(0, cut), key.slice(cut + 1)];
  const t = (await listTemplates(db, sandbox)).find((x) => x.id === templateId);
  const day = t ? runOn(t, date) : null;
  if (!t || !day) throw new HttpError(404, "Nie ma takiego kursu w paczce.");
  const e = await evaluateRun(db, sandbox.id, t, day, simNow, await loadMatchContext(db, sandbox.id));
  const candidates = e.results.filter((r) => r.tier !== "excluded").slice(0, 5).map((r) => asCandidate(r, e.windows));
  const facts: AdviceFacts = {
    templateName: t.name,
    clientName: t.clientName,
    date,
    deliveryTo: day.deliveryTo.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" }),
    defaultDriver: e.usual ? { name: e.usual.driverName, plates: e.usual.plates, ok: e.usualOk, reason: e.usualOk ? "" : (e.usual.reasons[0] ?? ""), hard: Boolean(e.usual.hard) } : null,
    chosen: e.chosen ? asCandidate(e.chosen, e.windows) : null,
    candidates,
    fixable: e.fixable.slice(0, 3),
    hard: e.hard.slice(0, 2),
  };
  const { advice, source } = await advisePlanRun({ db, sandboxId: sandbox.id, simNow, facts });
  return { ...advice, source, candidates: candidates.map((c) => ({ driverId: c.driverId, name: c.name, plates: c.plates })) };
}
export type RunAdvice = Awaited<ReturnType<typeof adviseRun>>;
