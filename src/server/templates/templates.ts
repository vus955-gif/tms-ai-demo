import { randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { clients, orders, orderTemplates, points } from "@/db/schema";
import type { Executor } from "@/db/types";
import { forecastState, plannedDays, type ForecastState } from "@/domain/recurring";
import { templatesSeed } from "@/simulation/scenario/templates";
import { HttpError } from "../http";
import { loadFleet } from "../monitoring/fleet-data";
import { matchVirtual } from "../orders/board";
import { createOrder } from "../orders/create";
import { registerSeedExtension } from "../sandbox/repository";

type TemplateRow = typeof orderTemplates.$inferSelect;

export async function seedTemplates(db: Executor, sandboxId: string, simNow: Date) {
  const existing = await db.select({ id: orderTemplates.id }).from(orderTemplates).where(eq(orderTemplates.sandboxId, sandboxId));
  if (existing.length > 0) return;
  await db.insert(orderTemplates).values(templatesSeed.map((t) => ({ sandboxId, ...t, adrRequired: false, active: true, createdSim: simNow })));
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
  if (rows.length === 0) {
    await seedTemplates(db, sandbox.id, sandbox.simOrigin);
    return listTemplates(db, sandbox);
  }
  const city = (id: string) => pts.find((p) => p.id === id)?.city ?? id;
  return rows
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

/**
 * Next week's recurring orders with a timeliness forecast from the same
 * matching as "klocki". Each order is forecast on its own (a driver can show up
 * as the best fit for two orders of one day).
 */
export async function weekPlan(db: Executor, sandbox: { id: string; simOrigin: Date }, simNow: Date): Promise<PlannedOrder[]> {
  const templates = (await listTemplates(db, sandbox)).filter((t) => t.active);
  const existing = await db.select({ key: orders.templateKey, number: orders.number }).from(orders).where(and(eq(orders.sandboxId, sandbox.id), isNotNull(orders.templateKey)));
  const fleet = await loadFleet(db, sandbox.id);
  const out: PlannedOrder[] = [];
  for (const t of templates) {
    for (const day of plannedDays(t, simNow)) {
      const key = `${t.id}:${day.date}`;
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
        fleet,
      );
      const best = results.find((r) => r.tier !== "excluded");
      const state = forecastState(best, day.pickupTo.getTime());
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
        reason: best ? best.reasons.slice(0, 2).join(" · ") : fixable.length > 0 ? fixable.slice(0, 2).join("; ") : `brak pojazdu: ${hard.slice(0, 2).join("; ")}`,
      });
    }
  }
  return out.sort((a, b) => a.pickupFrom.localeCompare(b.pickupFrom));
}

/** One click: the selected planned orders become NOWE orders (skipping ones already created). */
export async function createPlanned(db: Executor, sandbox: { id: string; simOrigin: Date }, keys: string[], simNow: Date) {
  const plan = await weekPlan(db, sandbox, simNow);
  const templates = await listTemplates(db, sandbox);
  const created: string[] = [];
  for (const key of keys) {
    const p = plan.find((x) => x.key === key);
    if (!p || p.orderNumber) continue;
    const t = templates.find((x) => x.id === p.templateId)!;
    const order = await createOrder(
      db,
      sandbox.id,
      {
        clientId: t.clientId,
        pickupPointId: t.pickupPointId,
        deliveryPointId: t.deliveryPointId,
        pickupFrom: p.pickupFrom,
        pickupTo: p.pickupTo,
        deliveryFrom: p.deliveryFrom,
        deliveryTo: p.deliveryTo,
        cargoPallets: t.cargoPallets,
        cargoKg: t.cargoKg,
        bodyRequired: t.bodyRequired,
        adrRequired: t.adrRequired,
        references: [...t.references, p.date.slice(5).replace("-", "")].slice(0, 5),
        notes: t.notes,
      },
      { simNow, source: "template", actor: "dispatcher", reason: `Zlecenie stałe: ${t.name}` },
    );
    await db.update(orders).set({ templateKey: key }).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, order.id)));
    created.push(order.number);
  }
  return created;
}

export const TemplateInputSchema = z
  .object({
    name: z.string().trim().min(3, "Nazwa: co najmniej 3 znaki").max(80),
    clientId: z.string().min(1).max(64),
    pickupPointId: z.string().min(1).max(64),
    deliveryPointId: z.string().min(1).max(64),
    pickupFromMin: z.number().int().min(0).max(1439),
    pickupToMin: z.number().int().min(1).max(1440),
    deliveryDayOffset: z.number().int().min(0).max(3),
    deliveryFromMin: z.number().int().min(0).max(1439),
    deliveryToMin: z.number().int().min(1).max(1440),
    cargoPallets: z.number().int().min(1).max(33),
    cargoKg: z.number().int().min(1).max(24000),
    bodyRequired: z.enum(["plandeka", "chlodnia", "skrzynia"]).nullable(),
    adrRequired: z.boolean(),
    references: z.array(z.string().max(40)).max(4),
    notes: z.string().max(300),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Wybierz co najmniej jeden dzień").max(7),
  })
  .refine((t) => t.pickupFromMin < t.pickupToMin, { message: "Okno załadunku musi kończyć się po rozpoczęciu" })
  .refine((t) => t.deliveryFromMin < t.deliveryToMin, { message: "Okno rozładunku musi kończyć się po rozpoczęciu" })
  .refine((t) => t.deliveryDayOffset > 0 || t.deliveryToMin > t.pickupFromMin, { message: "Rozładunek nie może kończyć się przed załadunkiem" })
  .refine((t) => t.pickupPointId !== t.deliveryPointId, { message: "Załadunek i rozładunek muszą być w różnych punktach" });

export async function saveTemplate(db: Executor, sandboxId: string, input: z.infer<typeof TemplateInputSchema>, simNow: Date, id?: string) {
  const own = await db.select({ id: points.id }).from(points).where(and(eq(points.sandboxId, sandboxId), eq(points.clientId, input.clientId)));
  if (![input.pickupPointId, input.deliveryPointId].every((p) => own.some((x) => x.id === p))) throw new HttpError(400, "Punkt nie należy do wybranego klienta.");
  const values = { ...input, weekdays: [...new Set(input.weekdays)].sort() };
  if (id) {
    const res = await db.update(orderTemplates).set(values).where(and(eq(orderTemplates.sandboxId, sandboxId), eq(orderTemplates.id, id))).returning({ id: orderTemplates.id });
    if (res.length === 0) throw new HttpError(404, "Nie ma takiego szablonu.");
    return id;
  }
  const newId = `tpl-${randomUUID().slice(0, 8)}`;
  await db.insert(orderTemplates).values({ sandboxId, id: newId, ...values, active: true, createdSim: simNow });
  return newId;
}

export async function setTemplateActive(db: Executor, sandboxId: string, id: string, active: boolean) {
  const res = await db.update(orderTemplates).set({ active }).where(and(eq(orderTemplates.sandboxId, sandboxId), eq(orderTemplates.id, id))).returning({ id: orderTemplates.id });
  if (res.length === 0) throw new HttpError(404, "Nie ma takiego szablonu.");
}

export async function deleteTemplate(db: Executor, sandboxId: string, id: string) {
  const res = await db.delete(orderTemplates).where(and(eq(orderTemplates.sandboxId, sandboxId), eq(orderTemplates.id, id))).returning({ id: orderTemplates.id });
  if (res.length === 0) throw new HttpError(404, "Nie ma takiego szablonu.");
}
