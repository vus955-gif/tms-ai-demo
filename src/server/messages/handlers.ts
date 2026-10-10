import { and, eq, gt } from "drizzle-orm";
import { drivers, messages, orders } from "@/db/schema";
import { reminderSms } from "@/domain/sms-templates";
import { createRng, seedFromString } from "@/simulation/random";
import { chooseBotReply, type BotReplyKind } from "@/simulation/bots/driver-replies";
import { openAlert } from "../alerts/repository";
import { registerEventHandler, type TickContext } from "../tick/registry";
import { driverThread, sendToDriver, storeDriverInbound } from "./gateway";
import { processDriverInbound } from "./inbound";

type EscalationPayload = { orderId: string; driverId: string; sentAt: string };

async function stillWaiting(ctx: TickContext, p: EscalationPayload) {
  const [order] = await ctx.tx.select().from(orders).where(and(eq(orders.sandboxId, ctx.sandbox.id), eq(orders.id, p.orderId)));
  if (!order || order.status !== "WYSLANE" || order.driverId !== p.driverId) return null;
  const replies = await ctx.tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.sandboxId, ctx.sandbox.id),
        eq(messages.threadKey, driverThread(p.driverId)),
        eq(messages.direction, "in"),
        gt(messages.atSim, new Date(p.sentAt)),
      ),
    );
  return replies.length === 0 ? order : null;
}

registerEventHandler("escalation.reminder", async (ctx, event) => {
  const p = event.payload as unknown as EscalationPayload;
  const order = await stillWaiting(ctx, p);
  if (!order) return;
  await sendToDriver(ctx.tx, ctx.sandbox.id, { driverId: p.driverId, body: reminderSms(order), kind: "reminder", orderId: order.id, sentBy: "system", atSim: ctx.simNow });
});

registerEventHandler("escalation.alert", async (ctx, event) => {
  const p = event.payload as unknown as EscalationPayload;
  const order = await stillWaiting(ctx, p);
  if (!order) return;
  const [driver] = await ctx.tx.select().from(drivers).where(and(eq(drivers.sandboxId, ctx.sandbox.id), eq(drivers.id, p.driverId)));
  await openAlert(
    ctx.tx,
    ctx.sandbox.id,
    {
      kind: "no_reply",
      severity: "warning",
      dedupeKey: `noreply:${order.id}:${p.sentAt}`,
      title: `${order.number}: kierowca nie potwierdził zlecenia`,
      body: `${driver ? `${driver.firstName} ${driver.lastName}` : "Kierowca"} nie odpowiada na SMS ani na przypomnienie. Zadzwoń albo przydziel innego kierowcę.`,
      actions: ["napisz_do_kierowcy", "przydziel_innego"],
      facts: { zlecenie: order.number },
      orderId: order.id,
      driverId: p.driverId,
      vehicleId: order.vehicleId,
    },
    ctx.simNow,
  );
});

/** A simulated driver answers an order SMS (unless the visitor plays this driver). */
registerEventHandler("bot.driver_reply", async (ctx, event) => {
  const p = event.payload as unknown as EscalationPayload & { forced: BotReplyKind | null };
  if (ctx.sandbox.phoneDriverId === p.driverId) return;
  const [order] = await ctx.tx.select().from(orders).where(and(eq(orders.sandboxId, ctx.sandbox.id), eq(orders.id, p.orderId)));
  if (!order || order.status !== "WYSLANE" || order.driverId !== p.driverId) return;
  const [driver] = await ctx.tx.select().from(drivers).where(and(eq(drivers.sandboxId, ctx.sandbox.id), eq(drivers.id, p.driverId)));
  const rng = createRng(ctx.sandbox.seed ^ seedFromString(`${event.id}`));
  const reply = chooseBotReply(rng, driver?.refusalPropensity ?? 0.1, p.forced ?? undefined);
  if (!reply.text) return;
  const messageId = await storeDriverInbound(ctx.tx, ctx.sandbox.id, { driverId: p.driverId, body: reply.text, atSim: ctx.simNow });
  scheduleProcessing(ctx, messageId);
});

/** Scripted driver message (small talk, road problems). */
registerEventHandler("driver.message", async (ctx, event) => {
  const p = event.payload as { driverId: string; body: string };
  if (ctx.sandbox.phoneDriverId === p.driverId) return;
  const messageId = await storeDriverInbound(ctx.tx, ctx.sandbox.id, { driverId: p.driverId, body: p.body, atSim: ctx.simNow });
  scheduleProcessing(ctx, messageId);
});

export function scheduleProcessing(ctx: TickContext, messageId: string) {
  const sandboxId = ctx.sandbox.id;
  const simNow = ctx.simNow;
  const skipAi = ctx.isStale(simNow);
  ctx.afterCommit(async (db) => {
    await processDriverInbound(db, sandboxId, messageId, { simNow, skipAi });
  });
}
