import { and, eq, inArray } from "drizzle-orm";
import { clientContacts, orders } from "@/db/schema";
import { createRng, seedFromString } from "@/simulation/random";
import { BOT_EMAILS, COMPLAINT_EMAIL_MEBLE, ORDER_EMAIL_WISLA, STATUS_EMAIL_MAZOVIA, type ScriptedEmail } from "@/simulation/scenario/client-emails";
import { addTimelineEntries } from "@/simulation/scenario/timeline";
import { registerEventHandler, type TickContext } from "../tick/registry";
import { storeClientInbound } from "./gateway";
import { processClientEmail } from "./process";

const MIN = 60_000;

async function receive(ctx: TickContext, mail: ScriptedEmail) {
  const messageId = await storeClientInbound(ctx.tx, ctx.sandbox.id, { ...mail, atSim: ctx.simNow });
  const sandboxId = ctx.sandbox.id;
  const simNow = ctx.simNow;
  const skipAi = ctx.isStale(simNow);
  ctx.afterCommit(async (db) => {
    await processClientEmail(db, sandboxId, messageId, { simNow, skipAi });
  });
}

/** Scripted e-mail from a client (spec §10.2). */
registerEventHandler("email.inbound", async (ctx, event) => {
  await receive(ctx, event.payload as unknown as ScriptedEmail);
});

/** Periodic client bot: one e-mail every 60 ± 15 simulated minutes from a rotating pool. */
registerEventHandler("bot.client_email", async (ctx, event) => {
  const { n } = event.payload as { n: number };
  for (let i = 0; i < BOT_EMAILS.length; i++) {
    const template = BOT_EMAILS[(n + i) % BOT_EMAILS.length];
    let body = template.body;
    if (template.needsOrder) {
      const [contact] = await ctx.tx.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, ctx.sandbox.id), eq(clientContacts.id, template.contactId)));
      const [order] = contact
        ? await ctx.tx
            .select()
            .from(orders)
            .where(and(eq(orders.sandboxId, ctx.sandbox.id), eq(orders.clientId, contact.clientId), inArray(orders.status, ["POTWIERDZONE", "ZALADUNEK", "W_DRODZE"])))
        : [];
      if (!order) continue;
      body = body.replaceAll("{ref}", order.references[0] ?? order.number);
    }
    await receive(ctx, { ...template, body });
    break;
  }
  const rng = createRng(ctx.sandbox.seed ^ seedFromString(`client-bot:${n}`));
  await ctx.schedule({ dueSim: new Date(ctx.simNow.getTime() + rng.int(45, 75) * MIN), type: "bot.client_email", payload: { n: n + 1 } });
});

addTimelineEntries([
  { atMin: 40, type: "email.inbound", payload: ORDER_EMAIL_WISLA },
  { atMin: 80, type: "bot.client_email", payload: { n: 0 } },
  { atMin: 120, type: "email.inbound", payload: STATUS_EMAIL_MAZOVIA },
  { atMin: 300, type: "email.inbound", payload: COMPLAINT_EMAIL_MEBLE },
]);
