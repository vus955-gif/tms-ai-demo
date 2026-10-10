import { and, desc, eq, inArray } from "drizzle-orm";
import { alerts, messages, orders, points, type AlertAction } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { classifyDriverMessage } from "@/ai/functions/classify-driver-message";
import type { DriverMessageClassification } from "@/ai/fallback/driver-message-rules";
import { windowText } from "@/domain/sms-templates";
import { openAlert } from "../alerts/repository";
import { transitionOrder } from "../orders/transition";

const CONFIDENT = 0.8;

export type DocumentListener = (db: Db, info: { sandboxId: string; messageId: string; driverId: string; simNow: Date; skipAi: boolean }) => Promise<void>;
const documentListeners: DocumentListener[] = [];
/** Stage 3 (CMR) hooks into documents sent by drivers. */
export function onDriverDocument(listener: DocumentListener) {
  documentListeners.push(listener);
}

async function orderLabel(db: Executor, sandboxId: string, order: typeof orders.$inferSelect) {
  const pts = await db.select().from(points).where(and(eq(points.sandboxId, sandboxId), inArray(points.id, [order.pickupPointId, order.deliveryPointId])));
  const city = (id: string) => pts.find((p) => p.id === id)?.city ?? id;
  return `${order.number} (${city(order.pickupPointId)} → ${city(order.deliveryPointId)}, załadunek ${windowText(order.pickupFrom, order.pickupTo)})`;
}

/**
 * Classifies one inbound driver message (AI or rules) and applies its effects:
 * confirmation → order confirmed by AI; refusal → order back to the pool;
 * conditions, questions, road problems → alerts for the dispatcher.
 */
export async function processDriverInbound(
  db: Db,
  sandboxId: string,
  messageId: string,
  opts: { simNow: Date; skipAi?: boolean },
): Promise<DriverMessageClassification> {
  const [msg] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));
  if (!msg || !msg.driverId) throw new Error(`Message ${messageId} not found`);
  const driverId = msg.driverId;
  const driverOrders = await db
    .select()
    .from(orders)
    .where(and(eq(orders.sandboxId, sandboxId), eq(orders.driverId, driverId)))
    .orderBy(desc(orders.createdSim));
  const pending = driverOrders.find((o) => o.status === "WYSLANE");
  const current = driverOrders.find((o) => ["POTWIERDZONE", "ZALADUNEK", "W_DRODZE", "ROZLADUNEK"].includes(o.status));

  const { value: c, source } = await classifyDriverMessage({
    db,
    sandboxId,
    simNow: opts.simNow,
    body: msg.body,
    hasAttachment: msg.attachments.length > 0,
    context: {
      pendingOrder: pending ? await orderLabel(db, sandboxId, pending) : null,
      currentOrder: current ? await orderLabel(db, sandboxId, current) : null,
    },
    messageId,
    skipAi: opts.skipAi,
  });

  const related = pending ?? current ?? null;
  await db
    .update(messages)
    .set({
      aiCategory: c.category,
      aiSubtype: c.subtype,
      aiPriority: c.priority,
      aiSummary: c.summary,
      aiSuggestedReplies: c.suggested_replies,
      aiConfidence: c.confidence,
      classifiedBy: source === "ai" ? "ai" : "rules",
      orderId: related?.id ?? null,
    })
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));

  const at = msg.atSim;
  const quote = `„${msg.body.slice(0, 80)}${msg.body.length > 80 ? "…" : ""}”`;
  const alert = (input: { kind: string; severity: "critical" | "warning" | "info"; title: string; body: string; actions: AlertAction[]; orderId?: string | null }) =>
    openAlert(
      db,
      sandboxId,
      {
        ...input,
        dedupeKey: `msg:${messageId}`,
        facts: { wiadomosc: msg.body, kategoria: c.category, podsumowanie: c.summary },
        driverId,
        vehicleId: related?.vehicleId ?? null,
        orderId: input.orderId ?? related?.id ?? null,
        messageId,
      },
      at,
    );

  switch (c.category) {
    case "potwierdzenie":
      if (pending && c.confidence >= CONFIDENT) {
        await transitionOrder(db, sandboxId, pending, "POTWIERDZONE", "ai", `Kierowca potwierdził: ${quote}`, at);
        await alert({
          kind: "order_confirmed",
          severity: "info",
          title: `${pending.number}: kierowca potwierdził zlecenie`,
          body: `Odpowiedź ${quote}. Zlecenie jest w realizacji.`,
          actions: ["brak"],
          orderId: pending.id,
        });
      } else if (pending) {
        await alert({
          kind: "driver_reply",
          severity: "warning",
          title: `${pending.number}: niepewne potwierdzenie`,
          body: `Odpowiedź ${quote} wygląda na zgodę, ale AI nie jest pewne. Potwierdź ręcznie albo dopytaj kierowcę.`,
          actions: ["napisz_do_kierowcy"],
          orderId: pending.id,
        });
      }
      break;
    case "odmowa":
      if (pending && c.confidence >= CONFIDENT) {
        await transitionOrder(db, sandboxId, pending, "NOWE", "system", `Odmowa kierowcy: ${quote}`, at, {
          driverId: null,
          vehicleId: null,
          trailerId: null,
        });
        await alert({
          kind: "order_refused",
          severity: "warning",
          title: `${pending.number}: kierowca odmówił`,
          body: `Odpowiedź ${quote}. Zlecenie wróciło do puli — wybierz innego kierowcę.`,
          actions: ["przydziel_innego", "napisz_do_kierowcy"],
          orderId: pending.id,
        });
      } else {
        await alert({
          kind: "driver_reply",
          severity: "warning",
          title: pending ? `${pending.number}: możliwa odmowa` : "Kierowca zgłasza, że nie da rady",
          body: `Odpowiedź ${quote}. ${c.summary}`,
          actions: ["napisz_do_kierowcy", "przydziel_innego"],
        });
      }
      break;
    case "warunek_pytanie":
      await alert({
        kind: "driver_reply",
        severity: "warning",
        title: pending ? `${pending.number}: odpowiedź z warunkiem lub pytaniem` : "Pytanie od kierowcy",
        body: `${c.summary} Wiadomość: ${quote}.`,
        actions: pending ? ["napisz_do_kierowcy", "przydziel_innego"] : ["napisz_do_kierowcy"],
      });
      break;
    case "niejasne":
      if (pending) {
        await alert({
          kind: "driver_reply",
          severity: "warning",
          title: `${pending.number}: niejasna odpowiedź kierowcy`,
          body: `Wiadomość ${quote} — zdecyduj, czy potwierdzić, czy dopytać.`,
          actions: ["napisz_do_kierowcy"],
        });
      }
      break;
    case "operacyjne": {
      // The system may already know (scripted incident) — avoid a duplicate alert.
      const vehicleId = related?.vehicleId;
      const existing = vehicleId
        ? await db
            .select({ id: alerts.id })
            .from(alerts)
            .where(and(eq(alerts.sandboxId, sandboxId), eq(alerts.vehicleId, vehicleId), inArray(alerts.status, ["open", "acknowledged"]), inArray(alerts.kind, ["breakdown", "road_check", "ramp_wait"])))
        : [];
      if (existing.length === 0) {
        await alert({
          kind: "driver_report",
          severity: "warning",
          title: `Zgłoszenie kierowcy: ${c.subtype ?? "problem w trasie"}`,
          body: `${c.summary} Wiadomość: ${quote}.`,
          actions: ["napisz_do_kierowcy", "powiadom_klienta"],
        });
      }
      break;
    }
    case "dokument":
      for (const listener of documentListeners) await listener(db, { sandboxId, messageId, driverId, simNow: opts.simNow, skipAi: Boolean(opts.skipAi) });
      break;
    case "luzne":
      break;
  }
  return c;
}
