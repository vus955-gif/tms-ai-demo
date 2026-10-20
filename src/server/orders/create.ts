import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { clients, orders, orderStatusChanges, points, type OrderStatus } from "@/db/schema";
import type { Executor } from "@/db/types";
import { HttpError } from "../http";
import { timeline } from "@/simulation/scenario/timeline";
import { nextOrderNumber } from "./numbering";

export const NewOrderSchema = z
  .object({
    clientId: z.string().min(1),
    pickupPointId: z.string().min(1),
    deliveryPointId: z.string().min(1),
    pickupFrom: z.iso.datetime(),
    pickupTo: z.iso.datetime(),
    deliveryFrom: z.iso.datetime(),
    deliveryTo: z.iso.datetime(),
    cargoPallets: z.number().int().min(1, "Podaj liczbę palet").max(33, "Najwyżej 33 palety"),
    cargoKg: z.number().int().min(1, "Podaj wagę").max(24000, "Najwyżej 24 000 kg"),
    bodyRequired: z.enum(["plandeka", "chlodnia", "skrzynia"]).nullable().default(null),
    adrRequired: z.boolean().default(false),
    references: z.array(z.string().max(60)).max(5).default([]),
    notes: z.string().max(500).default(""),
  })
  .refine((o) => o.pickupPointId !== o.deliveryPointId, { message: "Załadunek i rozładunek muszą być w różnych punktach" })
  .refine((o) => o.pickupFrom < o.pickupTo, { message: "Okno załadunku musi kończyć się po rozpoczęciu" })
  .refine((o) => o.deliveryFrom < o.deliveryTo, { message: "Okno rozładunku musi kończyć się po rozpoczęciu" })
  .refine((o) => o.deliveryTo > o.pickupFrom, { message: "Rozładunek nie może kończyć się przed załadunkiem" });

export type NewOrder = z.infer<typeof NewOrderSchema>;

/** Ids the scripted demo day will create later (e.g. zl-1042 at 09:05): nobody else may take them first. */
function scenarioOrderIds(): Set<string> {
  return new Set(timeline().filter((e) => e.type === "order.create" && typeof e.payload.id === "string").map((e) => e.payload.id as string));
}

/**
 * Ids follow numbers (ZL-1043 → zl-1043), which keeps worlds reproducible. An order made by a person
 * before a scripted one would otherwise take the scripted id and break the scenario's insert later.
 */
async function freeOrderId(db: Executor, sandboxId: string, number: string): Promise<string> {
  const base = number.toLowerCase();
  const [taken] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, base)));
  if (!taken && !scenarioOrderIds().has(base)) return base;
  return `${base}-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
}

/** Creates an order (NOWE, or SZKIC for AI drafts) after checking the points belong to the client. */
export async function createOrder(
  db: Executor,
  sandboxId: string,
  input: NewOrder,
  opts: { simNow: Date; source: "manual" | "scenario" | "email" | "template"; status?: Extract<OrderStatus, "NOWE" | "SZKIC">; sourceMessageId?: string | null; actor?: "dispatcher" | "system" | "ai"; id?: string; reason?: string; templateKey?: string },
) {
  const [client] = await db.select().from(clients).where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, input.clientId)));
  if (!client) throw new HttpError(400, "Nie ma takiego klienta.");
  const own = await db.select().from(points).where(and(eq(points.sandboxId, sandboxId), eq(points.clientId, input.clientId)));
  for (const id of [input.pickupPointId, input.deliveryPointId]) {
    if (!own.some((p) => p.id === id)) throw new HttpError(400, "Punkt nie należy do wybranego klienta.");
  }
  const number = await nextOrderNumber(db, sandboxId);
  // Ids follow numbers (ZL-1043 → zl-1043): stable across replays of the same world.
  const id = opts.id ?? (await freeOrderId(db, sandboxId, number));
  const status = opts.status ?? "NOWE";
  await db.insert(orders).values({
    sandboxId,
    id,
    number,
    clientId: input.clientId,
    pickupPointId: input.pickupPointId,
    pickupFrom: new Date(input.pickupFrom),
    pickupTo: new Date(input.pickupTo),
    deliveryPointId: input.deliveryPointId,
    deliveryFrom: new Date(input.deliveryFrom),
    deliveryTo: new Date(input.deliveryTo),
    cargoPallets: input.cargoPallets,
    cargoKg: input.cargoKg,
    bodyRequired: input.bodyRequired,
    adrRequired: input.adrRequired,
    references: input.references,
    notes: input.notes,
    status,
    etd: new Date(input.pickupTo),
    etaAgreed: new Date(input.deliveryTo),
    source: opts.source,
    sourceMessageId: opts.sourceMessageId ?? null,
    templateKey: opts.templateKey ?? null,
    createdSim: opts.simNow,
  });
  await db.insert(orderStatusChanges).values({
    sandboxId,
    id: randomUUID(),
    orderId: id,
    fromStatus: null,
    toStatus: status,
    actor: opts.actor ?? (opts.source === "manual" ? "dispatcher" : "system"),
    reason: opts.reason ?? (status === "SZKIC" ? "Szkic przygotowany przez AI z maila klienta" : opts.source === "manual" ? "Zlecenie założone przez spedytora" : "Nowe zlecenie ze scenariusza"),
    atSim: opts.simNow,
  });
  return { id, number };
}
