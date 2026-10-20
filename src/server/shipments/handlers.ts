import { and, eq, inArray, like } from "drizzle-orm";
import { agents, alerts, clients, messages, shipmentMilestones, shipments } from "@/db/schema";
import type { Executor } from "@/db/types";
import { draftShipmentUpdate } from "@/ai/functions/shipments";
import { formatShipmentDate, leaksAgentData } from "@/domain/shipment-texts";
import { AGENT_REMIND_AFTER_H, clientUpdateState, MODE_LABEL_GEN } from "@/domain/shipments";
import { agentStatusReplyText } from "@/simulation/bots/shipment-agent-replies";
import { localizePlace } from "@/simulation/scenario/shipment-places";
import { resolveAlerts } from "../alerts/repository";
import { onBeforeDraftSend, onDraftSent } from "../inbox/actions";
import { HttpError } from "../http";
import { saveDraft, storeClientOutbound } from "../inbox/gateway";
import { storeAgentMessage } from "../sales/gateway";
import { registerEventHandler, registerTickPhase, type TickContext } from "../tick/registry";
import { agentLanguage, agentRequestDue, agentThread, clientThread, routeOf, sendAgentRequest, setShipment, type MilestoneRow, type ShipmentRow } from "./gateway";
import { alertOnce, processAgentStatusReply } from "./reading";
import { agentGuardList, clientFacts, markClientUpdated } from "./shipments";

const H = 3_600_000;
const schedulerFor = (ctx: TickContext) => (dueSim: Date, payload: Record<string, unknown>) => ctx.schedule({ dueSim, type: "bot.shipment_agent_reply", payload });

/** Asks the agent on the rhythm (sooner when a milestone is overdue), reminds once, then tells the forwarder. */
async function agentStep(ctx: TickContext, s: ShipmentRow, ms: MilestoneRow[]) {
  const sandboxId = ctx.sandbox.id;
  const now = ctx.simNow.getTime();
  const remindAfter = AGENT_REMIND_AFTER_H[s.mode] * H;
  if (s.agentAwaitingReply && s.lastAgentRequestSim) {
    const since = (s.agentRemindedSim ?? s.lastAgentRequestSim).getTime();
    if (now - since < remindAfter) return;
    if (!s.agentRemindedSim) {
      await sendAgentRequest(ctx.tx, sandboxId, s, ctx.simNow, {
        reminder: true,
        by: "system",
        schedule: schedulerFor(ctx),
      });
      return;
    }
    const [agent] = await ctx.tx
      .select()
      .from(agents)
      .where(and(eq(agents.sandboxId, sandboxId), eq(agents.id, s.agentId)));
    await alertOnce(
      ctx.tx,
      sandboxId,
      {
        kind: "shipment_agent_silent",
        severity: "warning",
        dedupeKey: `shipment:${s.id}:agent_silent:${s.lastAgentRequestSim.getTime()}`,
        title: `${s.number}: agent nie odpowiada`,
        body: `${agent?.contactName ?? "Agent"}${agent ? ` (${agent.company})` : ""} nie odpowiedział na prośbę o status ani na przypomnienie. Warto zadzwonić — kolejne zapytanie system wyśle według harmonogramu.`,
        actions: ["otworz_przesylke"],
        facts: {
          shipmentId: s.id,
          number: s.number,
          agent: agent?.company ?? s.agentId,
        },
      },
      ctx.simNow,
    );
    await setShipment(ctx.tx, sandboxId, s.id, { agentAwaitingReply: false });
    return;
  }
  const due = agentRequestDue(s, ms, now);
  if (now >= due)
    await sendAgentRequest(ctx.tx, sandboxId, s, ctx.simNow, {
      reminder: false,
      by: "system",
      schedule: schedulerFor(ctx),
    });
}

async function clientName(ctx: TickContext, clientId: string) {
  const key = `shipments:client:${clientId}`;
  if (!ctx.cache.has(key)) {
    const [c] = await ctx.tx
      .select({ name: clients.name })
      .from(clients)
      .where(and(eq(clients.sandboxId, ctx.sandbox.id), eq(clients.id, clientId)));
    ctx.cache.set(key, c?.name ?? "Klient");
  }
  return ctx.cache.get(key) as string;
}

/** Client updates: a reminder before the due time and a warning after it — or, if switched on, the update goes out by itself. */
async function clientStep(ctx: TickContext, s: ShipmentRow, ms: MilestoneRow[]) {
  if (!s.nextClientUpdateSim) return;
  const sandboxId = ctx.sandbox.id;
  const due = s.nextClientUpdateSim.getTime();
  const state = clientUpdateState(due, ctx.simNow.getTime());
  if (state === "ok") return;

  if (s.autoClientUpdates && s.contactId) {
    if (state !== "po_terminie") return;
    await autoSend(ctx, s, ms);
    return;
  }

  const name = await clientName(ctx, s.clientId);
  const time = formatShipmentDate(due);
  if (state === "wkrotce") {
    // A fresh ETA alert already asks for the update — one alert per piece of news.
    const [etaAlert] = await ctx.tx
      .select({ id: alerts.id })
      .from(alerts)
      .where(and(eq(alerts.sandboxId, sandboxId), like(alerts.dedupeKey, `shipment:${s.id}:eta:%`), inArray(alerts.status, ["open", "acknowledged"])));
    if (etaAlert) return;
    await alertOnce(
      ctx.tx,
      sandboxId,
      {
        kind: "shipment_client_due",
        severity: "info",
        dedupeKey: `shipment:${s.id}:client_soon:${due}`,
        title: `Status dla klienta do ${time.slice(-5)} — ${s.number}`,
        body: `${name} czeka na status przesyłki ${MODE_LABEL_GEN[s.mode]} ${routeOf(s)} (termin ${time}). „Przygotuj status” — AI napisze szkic z potwierdzonych faktów, Ty go sprawdzasz i wysyłasz.`,
        actions: ["otworz_przesylke"],
        facts: {
          shipmentId: s.id,
          number: s.number,
          client: name,
          due: s.nextClientUpdateSim.toISOString(),
        },
      },
      ctx.simNow,
    );
    return;
  }
  await resolveAlerts(ctx.tx, sandboxId, `shipment:${s.id}:client_soon`, ctx.simNow);
  await alertOnce(
    ctx.tx,
    sandboxId,
    {
      kind: "shipment_client_due",
      severity: "warning",
      dedupeKey: `shipment:${s.id}:client_due:${due}`,
      title: `Status dla klienta po terminie — ${s.number}`,
      body: `Termin statusu dla ${name} minął (${time}). Przygotuj i wyślij status albo włącz automatyczne aktualizacje dla tej przesyłki.`,
      actions: ["otworz_przesylke"],
      facts: {
        shipmentId: s.id,
        number: s.number,
        client: name,
        due: s.nextClientUpdateSim.toISOString(),
      },
    },
    ctx.simNow,
  );
}

/**
 * Automatic client update (opt-in per shipment). The schedule is claimed inside the
 * tick; AI writes the mail after the commit, the template when nobody is watching.
 */
async function autoSend(ctx: TickContext, s: ShipmentRow, ms: MilestoneRow[]) {
  const sandboxId = ctx.sandbox.id;
  const simNow = ctx.simNow;
  const contactId = s.contactId!;
  await markClientUpdated(ctx.tx, sandboxId, s.id, simNow, { automatic: true });
  const facts = await clientFacts(ctx.tx, sandboxId, s, ms, simNow);
  const guard = await agentGuardList(ctx.tx, sandboxId);
  // A due time nobody watched (catch-up after a pause): the template, no AI call.
  const skipAi = s.nextClientUpdateSim ? ctx.isStale(s.nextClientUpdateSim) : false;
  const write = async (db: Executor) => {
    const outcome = await draftShipmentUpdate({ db, sandboxId, simNow, facts, agents: guard, skipAi });
    const mail = { threadKey: clientThread(s.id), contactId, subject: outcome.value.subject, body: outcome.value.body, atSim: simNow };
    const classifiedBy = outcome.source === "ai" ? ("ai" as const) : ("rules" as const);
    if (!outcome.blocked) {
      await storeClientOutbound(db, sandboxId, { ...mail, kind: "shipment_update_auto", classifiedBy });
      return;
    }
    // The guard still objects: the text waits as a draft and a person decides.
    await saveDraft(db, sandboxId, { ...mail, kind: "shipment_update", classifiedBy });
    await alertOnce(
      db,
      sandboxId,
      {
        kind: "shipment_client_due",
        severity: "warning",
        dedupeKey: `shipment:${s.id}:client_blocked:${simNow.getTime()}`,
        title: `Automatyczny status zatrzymany — ${s.number}`,
        body: "Tekst statusu dla klienta zawierał dane agenta albo kwotę, więc nie został wysłany. Sprawdź szkic w przesyłce i wyślij go ręcznie.",
        actions: ["otworz_przesylke"],
        facts: { shipmentId: s.id, number: s.number },
      },
      simNow,
    );
  };
  if (skipAi) await write(ctx.tx);
  else ctx.afterCommit((db) => write(db));
}

async function shipmentsPhase(ctx: TickContext) {
  const sandboxId = ctx.sandbox.id;
  const list = await ctx.tx
    .select()
    .from(shipments)
    .where(and(eq(shipments.sandboxId, sandboxId), inArray(shipments.status, ["planowana", "w_drodze"])));
  if (list.length === 0) return;
  const ms = await ctx.tx
    .select()
    .from(shipmentMilestones)
    .where(
      and(
        eq(shipmentMilestones.sandboxId, sandboxId),
        inArray(
          shipmentMilestones.shipmentId,
          list.map((s) => s.id),
        ),
      ),
    );
  for (const s of list) {
    const mine = ms.filter((m) => m.shipmentId === s.id).sort((a, b) => a.seq - b.seq);
    await agentStep(ctx, s, mine);
    await clientStep(ctx, s, mine);
  }
}

registerTickPhase("shipments", shipmentsPhase);

/** Demo bot: the agent answers with what has really happened by now (from the shipment's hidden truth). */
registerEventHandler("bot.shipment_agent_reply", async (ctx, event) => {
  const p = event.payload as { shipmentId: string; requestId: string };
  const sandboxId = ctx.sandbox.id;
  const [s] = await ctx.tx
    .select()
    .from(shipments)
    .where(and(eq(shipments.sandboxId, sandboxId), eq(shipments.id, p.shipmentId)));
  if (!s || s.status === "anulowana" || s.status === "dostarczona") return;
  const [agent] = await ctx.tx
    .select()
    .from(agents)
    .where(and(eq(agents.sandboxId, sandboxId), eq(agents.id, s.agentId)));
  const [request] = await ctx.tx
    .select({ subject: messages.subject })
    .from(messages)
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, p.requestId)));
  const ms = await ctx.tx
    .select()
    .from(shipmentMilestones)
    .where(and(eq(shipmentMilestones.sandboxId, sandboxId), eq(shipmentMilestones.shipmentId, s.id)));
  const lang = agentLanguage(s.agentId);
  const body = agentStatusReplyText({
    language: lang,
    mode: s.mode,
    number: s.number,
    contactName: agent?.contactName ?? "",
    milestones: ms
      .sort((a, b) => a.seq - b.seq)
      .map((m) => ({
        kind: m.kind,
        location: localizePlace(m.location, lang),
        plannedMs: m.plannedSim.getTime(),
      })),
    truth: s.truth,
    nowMs: ctx.simNow.getTime(),
  });
  const messageId = await storeAgentMessage(ctx.tx, sandboxId, {
    agentId: s.agentId,
    threadKey: agentThread(s.id),
    direction: "in",
    subject: `${lang === "en" ? "RE" : "Re"}: ${(request?.subject ?? `Status ${s.number}`).replace(/^(Przypomnienie|Reminder): /, "")}`,
    body,
    atSim: ctx.simNow,
    state: "received",
    sentBy: "agent",
    kind: "shipment_status_reply",
  });
  await setShipment(ctx.tx, sandboxId, s.id, {
    agentAwaitingReply: false,
    agentRemindedSim: null,
  });
  await resolveAlerts(ctx.tx, sandboxId, `shipment:${s.id}:agent_silent`, ctx.simNow);
  const simNow = ctx.simNow;
  if (ctx.isStale(simNow))
    await processAgentStatusReply(ctx.tx, sandboxId, messageId, {
      simNow,
      skipAi: true,
    });
  else ctx.afterCommit((db) => processAgentStatusReply(db, sandboxId, messageId, { simNow }));
});

/** Whichever way a client update goes out (shipment page or inbox), agent data and money are stopped. */
onBeforeDraftSend(async (db, { sandboxId, message, edit }) => {
  if (!/^shp:.+:client$/.test(message.threadKey)) return;
  if (leaksAgentData(`${edit.subject}\n${edit.body}`, await agentGuardList(db, sandboxId))) {
    throw new HttpError(409, "Wiadomość do klienta zawiera dane agenta (firmę, osobę, adres) albo kwotę — usuń je przed wysłaniem.");
  }
});

/** A client update sent from the shipment page or from the inbox moves the schedule on. */
onDraftSent(async (db, { sandboxId, message, simNow }) => {
  const shipmentId = message.threadKey.match(/^shp:(.+):client$/)?.[1];
  if (shipmentId) await markClientUpdated(db, sandboxId, shipmentId, simNow);
});
