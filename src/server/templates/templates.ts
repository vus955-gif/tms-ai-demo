import { randomUUID } from "node:crypto";
import { and, count, eq, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";
import { clients, orders, orderTemplates, points } from "@/db/schema";
import type { Executor } from "@/db/types";
import { uniqueViolation } from "@/db/errors";
import { forecastState, plannedDays, runOn, warsawDate, type ForecastState } from "@/domain/recurring";
import { templatesSeed } from "@/simulation/scenario/templates";
import { HttpError } from "../http";
import { loadMatchContext, matchVirtual } from "../orders/board";
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
};

const planKey = (templateId: string, date: string) => `${templateId}:${date}`;

/** Orders already made from templates; a cancelled one frees its day again. */
async function liveTemplateOrders(db: Executor, sandboxId: string) {
  return db
    .select({ key: orders.templateKey, number: orders.number })
    .from(orders)
    .where(and(eq(orders.sandboxId, sandboxId), isNotNull(orders.templateKey), ne(orders.status, "ANULOWANE")));
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
      const results = await matchVirtual(
        db,
        sandbox.id,
        {
          id: key,
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
      const best = results.find((r) => r.tier !== "excluded");
      const state = forecastState(best, { pickupToMs: day.pickupTo.getTime(), deliveryToMs: day.deliveryTo.getTime() });
      const dropped = results.filter((r) => r.tier === "excluded");
      // Vehicles that fit the load but are out for now (deadline, absence, too far) say what to fix.
      const fixable = dropped.filter((r) => !r.hard).map((r) => `${r.plates}: ${r.reasons[0]}`);
      const hard = [...new Set(dropped.filter((r) => r.hard).map((r) => r.reasons[0]))];
      out.push({
        key,
        templateId: t.id,
        templateName: t.name,
        date: day.date,
        pickupFrom: day.pickupFrom.toISOString(),
        pickupTo: day.pickupTo.toISOString(),
        deliveryFrom: day.deliveryFrom.toISOString(),
        deliveryTo: day.deliveryTo.toISOString(),
        orderNumber: existing.find((e) => e.key === key)?.number ?? null,
        forecast: state,
        bestDriver: best?.driverName ?? null,
        bestPlates: best?.plates ?? null,
        reason: best
          ? best.reasons.slice(0, 2).join(" · ")
          : fixable.length > 0
            ? fixable.slice(0, 2).join("; ")
            : hard.length > 0
              ? `brak pojazdu: ${hard.slice(0, 2).join("; ")}`
              : "brak pojazdów we flocie",
      });
    }
  }
  return out.sort((a, b) => a.pickupFrom.localeCompare(b.pickupFrom));
}

export type PlanSkip = { key: string; reason: string };

/**
 * One click: the selected planned orders become NOWE orders. A key is resolved
 * from its own date (not from a fresh plan), so a selection made just before
 * midnight still works; the database guarantees one live order per template and day.
 */
export async function createPlanned(db: Executor, sandbox: { id: string; simOrigin: Date }, keys: string[], simNow: Date): Promise<{ created: string[]; skipped: PlanSkip[] }> {
  const [templates, existing] = await Promise.all([listTemplates(db, sandbox), liveTemplateOrders(db, sandbox.id)]);
  const today = warsawDate(simNow);
  const lastDay = warsawDate(simNow, PLAN_DAYS);
  const created: string[] = [];
  const skipped: PlanSkip[] = [];
  for (const key of new Set(keys)) {
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
      const order = await (db as Executor).transaction((tx) =>
        createOrder(
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
        ),
      );
      created.push(order.number);
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
  })
  .refine((t) => t.pickupFromMin < t.pickupToMin, { message: "Okno załadunku musi kończyć się po rozpoczęciu" })
  .refine((t) => t.deliveryFromMin < t.deliveryToMin, { message: "Okno rozładunku musi kończyć się po rozpoczęciu" })
  .refine((t) => t.deliveryDayOffset > 0 || t.deliveryToMin > t.pickupFromMin, { message: "Rozładunek nie może kończyć się przed załadunkiem" })
  .refine((t) => t.pickupPointId !== t.deliveryPointId, { message: "Załadunek i rozładunek muszą być w różnych punktach" });

const live = (sandboxId: string, id: string) => and(eq(orderTemplates.sandboxId, sandboxId), eq(orderTemplates.id, id), eq(orderTemplates.archived, false));

export async function saveTemplate(db: Executor, sandboxId: string, input: z.infer<typeof TemplateInputSchema>, simNow: Date, id?: string) {
  const own = await db.select({ id: points.id }).from(points).where(and(eq(points.sandboxId, sandboxId), eq(points.clientId, input.clientId)));
  if (![input.pickupPointId, input.deliveryPointId].every((p) => own.some((x) => x.id === p))) throw new HttpError(400, "Punkt nie należy do wybranego klienta.");
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
