import { and, eq } from "drizzle-orm";
import { orders } from "@/db/schema";
import type { Executor } from "@/db/types";
import { addTimelineEntries } from "@/simulation/scenario/timeline";
import type { BotReplyKind } from "@/simulation/bots/driver-replies";
import { atMin } from "../sandbox/seed";
import { registerEventHandler } from "../tick/registry";
import { assignOrder } from "./assign";
import { createOrder } from "./create";

type ScenarioOrderPayload = {
  id: string;
  clientId: string;
  pickupPointId: string;
  deliveryPointId: string;
  pickupFromMin: number;
  pickupToMin: number;
  deliveryFromMin: number;
  deliveryToMin: number;
  cargoPallets: number;
  cargoKg: number;
  references: string[];
  notes?: string;
};

async function orderExists(db: Executor, sandboxId: string, id: string) {
  const [row] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, id)));
  return Boolean(row);
}

registerEventHandler("order.create", async (ctx, event) => {
  const p = event.payload as unknown as ScenarioOrderPayload;
  const t = (m: number) => atMin(ctx.sandbox.simOrigin, m).toISOString();
  await createOrder(
    ctx.tx,
    ctx.sandbox.id,
    {
      clientId: p.clientId,
      pickupPointId: p.pickupPointId,
      deliveryPointId: p.deliveryPointId,
      pickupFrom: t(p.pickupFromMin),
      pickupTo: t(p.pickupToMin),
      deliveryFrom: t(p.deliveryFromMin),
      deliveryTo: t(p.deliveryToMin),
      cargoPallets: p.cargoPallets,
      cargoKg: p.cargoKg,
      bodyRequired: null,
      adrRequired: false,
      references: p.references,
      notes: p.notes ?? "",
    },
    // Worlds where a person took this id first (before the fix in createOrder) still get the scripted order.
    { simNow: ctx.simNow, source: "scenario", id: (await orderExists(ctx.tx, ctx.sandbox.id, p.id)) ? `${p.id}-s` : p.id },
  );
});

registerEventHandler("order.assign_scenario", async (ctx, event) => {
  const p = event.payload as { orderId: string; driverId: string; forced?: BotReplyKind; replyAfterMin?: number };
  await assignOrder(ctx.tx, ctx.sandbox.id, p.orderId, p.driverId, {
    actor: "system",
    simNow: ctx.simNow,
    forcedReply: p.forced,
    replyAfterMin: p.replyAfterMin,
  }).catch((error: Error) => console.warn(`[scenario] order.assign_scenario skipped: ${error.message}`));
});

/** Stage 2 scripted events (spec §10.2). */
addTimelineEntries([
  {
    atMin: 35,
    type: "order.create",
    payload: {
      id: "zl-1042",
      clientId: "cl-hanza",
      pickupPointId: "pt-hanza-poznan",
      deliveryPointId: "pt-hanza-szczecin",
      pickupFromMin: 120,
      pickupToMin: 180,
      deliveryFromMin: 330,
      deliveryToMin: 450,
      cargoPallets: 6,
      cargoKg: 900,
      references: ["HR-ZWR-0918"],
      notes: "Zwrot opakowań do magazynu w Szczecinie",
    },
  },
  {
    atMin: 50,
    type: "order.assign_scenario",
    payload: { orderId: "zl-1042", driverId: "d-grabowski", forced: "refusal", replyAfterMin: 6 },
  },
  {
    atMin: 60,
    type: "driver.message",
    payload: { driverId: "d-wojcik", body: "Dzień dobry, jestem na MOP-ie przed Gdańskiem, robię przerwę. Wszystko ok." },
  },
  {
    atMin: 241,
    type: "driver.message",
    payload: { driverId: "d-kowalczyk", body: "Złapałem gumę, stoję na poboczu. Serwis mobilny będzie za ok. 1,5 h." },
  },
  {
    atMin: 281,
    type: "driver.message",
    payload: { driverId: "d-szymanski", body: "Kontrola ITD, sprawdzają tachograf i dokumenty. Postoję ok. 40 min." },
  },
]);
