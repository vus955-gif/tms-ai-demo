import { and, eq, isNull } from "drizzle-orm";
import { clients, couplings, drivers, orders, points, sandboxes, type StatusActor } from "@/db/schema";
import type { Executor } from "@/db/types";
import { escalationTimes } from "@/domain/escalation";
import { cancellationSms, orderSms } from "@/domain/sms-templates";
import { createRng, seedFromString } from "@/simulation/random";
import { botReplyDelayMin, type BotReplyKind } from "@/simulation/bots/driver-replies";
import { HttpError } from "../http";
import { sendToDriver } from "../messages/gateway";
import { scheduleEvent } from "../tick/engine";
import { registerEventHandler } from "../tick/registry";
import { transitionOrder } from "./transition";

type OrderRow = typeof orders.$inferSelect;

async function loadOrder(db: Executor, sandboxId: string, orderId: string): Promise<OrderRow> {
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, orderId)));
  if (!order) throw new HttpError(404, "Nie ma takiego zlecenia.");
  return order;
}

/**
 * Assigns a NOWE order to a driver: PRZYPISANE, then the order SMS (from the template)
 * — now, or at `smsAt` (e.g. the day before a recurring run) — with escalation steps and,
 * unless the visitor plays this driver, the simulated driver's reply.
 */
export async function assignOrder(
  db: Executor,
  sandboxId: string,
  orderId: string,
  driverId: string,
  opts: { actor: StatusActor; simNow: Date; forcedReply?: BotReplyKind; replyAfterMin?: number; smsAt?: Date },
) {
  const order = await loadOrder(db, sandboxId, orderId);
  if (order.status !== "NOWE") throw new HttpError(409, "Przydzielić można tylko nowe zlecenie.");
  const [driver] = await db.select().from(drivers).where(and(eq(drivers.sandboxId, sandboxId), eq(drivers.id, driverId)));
  if (!driver || !driver.vehicleId) throw new HttpError(404, "Nie ma takiego kierowcy.");
  const [coupling] = await db
    .select()
    .from(couplings)
    .where(and(eq(couplings.sandboxId, sandboxId), eq(couplings.vehicleId, driver.vehicleId), isNull(couplings.toSim)));

  const at = opts.simNow;
  const later = opts.smsAt && opts.smsAt.getTime() > at.getTime() ? opts.smsAt : null;
  await transitionOrder(db, sandboxId, order, "PRZYPISANE", opts.actor, opts.actor === "system" ? "Przydział ze scenariusza" : "Przydział przez spedytora", at, {
    driverId,
    vehicleId: driver.vehicleId,
    trailerId: coupling?.trailerId ?? null,
    smsDueSim: later,
  });
  if (later) {
    await scheduleEvent(db, sandboxId, { dueSim: later, type: "order.send_sms", payload: { orderId, driverId } });
    return;
  }
  await sendOrderSms(db, sandboxId, orderId, driverId, { simNow: at, forcedReply: opts.forcedReply, replyAfterMin: opts.replyAfterMin });
}

/** PRZYPISANE → WYSLANE: the order SMS, escalation steps and the bot's reply. */
export async function sendOrderSms(db: Executor, sandboxId: string, orderId: string, driverId: string, opts: { simNow: Date; forcedReply?: BotReplyKind; replyAfterMin?: number }) {
  const order = await loadOrder(db, sandboxId, orderId);
  const at = opts.simNow;
  await transitionOrder(db, sandboxId, { id: order.id, status: "PRZYPISANE" }, "WYSLANE", "system", "Wysłano SMS ze zleceniem", at, { smsDueSim: null });

  const pts = await db.select().from(points).where(eq(points.sandboxId, sandboxId));
  const pickup = pts.find((p) => p.id === order.pickupPointId)!;
  const delivery = pts.find((p) => p.id === order.deliveryPointId)!;
  const [client] = await db.select().from(clients).where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, order.clientId)));
  await sendToDriver(db, sandboxId, {
    driverId,
    body: orderSms(order, client?.name ?? "", pickup, delivery),
    kind: "order",
    orderId: order.id,
    sentBy: "system",
    atSim: at,
  });

  const { reminderMs, alertMs } = escalationTimes(at.getTime(), order.pickupFrom.getTime());
  const payload = { orderId: order.id, driverId, sentAt: at.toISOString() };
  await scheduleEvent(db, sandboxId, { dueSim: new Date(reminderMs), type: "escalation.reminder", payload });
  await scheduleEvent(db, sandboxId, { dueSim: new Date(alertMs), type: "escalation.alert", payload });

  const [sandbox] = await db.select({ phone: sandboxes.phoneDriverId, seed: sandboxes.seed }).from(sandboxes).where(eq(sandboxes.id, sandboxId));
  if (sandbox?.phone !== driverId) {
    const rng = createRng((sandbox?.seed ?? 1) ^ seedFromString(`${order.id}:${driverId}:${at.getTime()}`));
    const delay = opts.replyAfterMin ?? botReplyDelayMin(rng);
    await scheduleEvent(db, sandboxId, {
      dueSim: new Date(at.getTime() + delay * 60_000),
      type: "bot.driver_reply",
      payload: { ...payload, forced: opts.forcedReply ?? null },
    });
  }
}

/** The scheduled order SMS (day before the run): only if the order still waits for it with the same driver. */
registerEventHandler("order.send_sms", async (ctx, event) => {
  const p = event.payload as { orderId: string; driverId: string };
  const [order] = await ctx.tx.select().from(orders).where(and(eq(orders.sandboxId, ctx.sandbox.id), eq(orders.id, p.orderId)));
  if (!order || order.status !== "PRZYPISANE" || order.driverId !== p.driverId) return;
  await sendOrderSms(ctx.tx, ctx.sandbox.id, order.id, p.driverId, { simNow: ctx.simNow });
});

/** Takes an order back from a driver (cancellation SMS) and returns it to the pool. */
export async function unassignOrder(db: Executor, sandboxId: string, orderId: string, simNow: Date) {
  const order = await loadOrder(db, sandboxId, orderId);
  if (!order.driverId || !["PRZYPISANE", "WYSLANE"].includes(order.status)) {
    throw new HttpError(409, "Cofnąć można tylko przydział niepotwierdzonego zlecenia.");
  }
  await transitionOrder(db, sandboxId, order, "NOWE", "dispatcher", "Cofnięcie przydziału", simNow, { driverId: null, vehicleId: null, trailerId: null, smsDueSim: null });
  // The driver only hears about it if the order SMS has gone out.
  if (order.status === "WYSLANE") await sendToDriver(db, sandboxId, { driverId: order.driverId, body: cancellationSms(order), kind: "cancellation", orderId, sentBy: "system", atSim: simNow });
}

/** Dispatcher confirms on the driver's behalf (e.g. after a phone call). */
export async function confirmOrder(db: Executor, sandboxId: string, orderId: string, simNow: Date) {
  const order = await loadOrder(db, sandboxId, orderId);
  await transitionOrder(db, sandboxId, order, "POTWIERDZONE", "dispatcher", "Potwierdzone ręcznie przez spedytora", simNow);
}

export async function cancelOrder(db: Executor, sandboxId: string, orderId: string, simNow: Date) {
  const order = await loadOrder(db, sandboxId, orderId);
  await transitionOrder(db, sandboxId, order, "ANULOWANE", "dispatcher", "Anulowane przez spedytora", simNow);
  if (order.driverId && ["WYSLANE", "POTWIERDZONE"].includes(order.status)) {
    await sendToDriver(db, sandboxId, { driverId: order.driverId, body: cancellationSms(order), kind: "cancellation", orderId, sentBy: "system", atSim: simNow });
  }
}
