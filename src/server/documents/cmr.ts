import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { clients, documents, driverClientHistory, drivers, messages, orders, points } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { readCmr, type CmrReading } from "@/ai/functions/read-cmr";
import { CMR_AUTO_THRESHOLD, matchCmr, type CmrCandidate } from "@/domain/cmr-matching";
import { cmrMissingSms, cmrResendSms } from "@/domain/sms-templates";
import { formatWarsaw } from "@/lib/format";
import { createRng, seedFromString } from "@/simulation/random";
import { cmrSample, samplesForOrder, type CmrVariant } from "@/simulation/scenario/cmr-samples";
import { recordAiAction } from "../ai-actions";
import { openAlert, resolveAlerts } from "../alerts/repository";
import { HttpError } from "../http";
import { sendToDriver, storeDriverInbound } from "../messages/gateway";
import { scheduleProcessing } from "../messages/handlers";
import { onDriverDocument, type UploadedImage } from "../messages/inbound";
import { onMovement } from "../monitoring/movement";
import { transitionOrder } from "../orders/transition";
import { registerEventHandler } from "../tick/registry";

const SAMPLES_DIR = path.join(process.cwd(), "public", "cmr-samples");
const MIN = 60_000;

export function loadSampleImage(sampleId: string): UploadedImage | null {
  const sample = cmrSample(sampleId);
  if (!sample) return null;
  const file = path.join(SAMPLES_DIR, path.basename(sample.file));
  if (!existsSync(/*turbopackIgnore: true*/ file)) return null;
  return { data: readFileSync(/*turbopackIgnore: true*/ file).toString("base64"), mediaType: "image/jpeg" };
}

async function candidatesFor(db: Executor, sandboxId: string, driverId: string): Promise<CmrCandidate[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.sandboxId, sandboxId), eq(orders.driverId, driverId), eq(orders.status, "ROZLADUNEK")));
  const pts = await db.select().from(points).where(eq(points.sandboxId, sandboxId));
  const cls = await db.select().from(clients).where(eq(clients.sandboxId, sandboxId));
  return rows.map((o) => {
    const delivery = pts.find((p) => p.id === o.deliveryPointId);
    const client = cls.find((c) => c.id === o.clientId);
    const dates = o.arrivedDeliveryAt ? [formatWarsaw(o.arrivedDeliveryAt, "dd.MM"), formatWarsaw(o.arrivedDeliveryAt, "yyyy-MM-dd")] : [];
    return {
      orderId: o.id,
      number: o.number,
      references: o.references,
      deliveryCity: delivery?.city ?? "",
      consigneeNames: [delivery?.name ?? "", client?.name ?? ""].filter(Boolean),
      deliveryDates: dates,
    };
  });
}

/**
 * A driver sent a CMR photo: AI reads it, the quality is checked while the
 * driver is still on site, and the document is matched to an order. Only a
 * confident match moves the order to DO_ZAMKNIECIA; closing stays with the dispatcher.
 */
export async function handleCmrDocument(
  db: Db,
  info: { sandboxId: string; messageId: string; driverId: string; simNow: Date; skipAi: boolean; uploaded?: UploadedImage },
) {
  const { sandboxId, messageId, driverId, simNow } = info;
  const [msg] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));
  if (!msg) return;
  const attachment = msg.attachments[0];
  const sampleId = attachment?.sampleId ?? null;
  const image = info.uploaded ?? (sampleId ? loadSampleImage(sampleId) : null);
  const docId = randomUUID();
  const base = { sandboxId, id: docId, messageId, driverId, kind: "cmr" as const, imageRef: sampleId, createdSim: msg.atSim };

  if (!image) {
    await db.insert(documents).values({ ...base, status: "do_weryfikacji", note: "Brak obrazu do odczytu.", readBy: "fallback" });
    return;
  }
  const outcome = await readCmr({ db, sandboxId, simNow, image, inputRef: sampleId ? `CMR ${sampleId}` : "CMR (własne zdjęcie)", skipAi: info.skipAi });
  const reading = outcome.value;
  if (outcome.source !== "ai" || !reading) {
    await db.insert(documents).values({
      ...base,
      status: "do_weryfikacji",
      readBy: "fallback",
      note: info.uploaded ? "Odczyt automatyczny niedostępny, a własne zdjęcie nie jest przechowywane." : "Odczyt automatyczny niedostępny — sprawdź dokument i przypisz go ręcznie.",
    });
    await openAlert(db, sandboxId, cmrAlert(docId, "info", "CMR do weryfikacji", "Dokument czeka na ręczne sprawdzenie (AI niedostępne).", driverId), msg.atSim);
    return;
  }
  const quality = { legible: reading.legible, stamp: reading.consignee_stamp, signature: reading.consignee_signature, remarks: reading.remarks };
  if (!reading.legible) {
    await db.insert(documents).values({ ...base, status: "nieczytelny", readBy: "ai", extracted: reading as unknown as Record<string, unknown>, quality });
    await sendToDriver(db, sandboxId, { driverId, body: cmrResendSms(), kind: "cmr_resend", sentBy: "system", atSim: msg.atSim });
    await scheduleBotResend(db, sandboxId, driverId, sampleId, msg.atSim);
    return;
  }
  const matches = matchCmr(fieldsOf(reading), await candidatesFor(db, sandboxId, driverId));
  const best = matches[0];
  const confident = best && best.score >= CMR_AUTO_THRESHOLD;
  await db.insert(documents).values({
    ...base,
    status: confident ? "do_zamkniecia" : "do_weryfikacji",
    readBy: "ai",
    extracted: reading as unknown as Record<string, unknown>,
    quality,
    matchCandidates: matches,
    matchedOrderId: confident ? best.orderId : null,
    matchScore: best?.score ?? null,
    decidedBy: confident ? "ai" : null,
    decidedAtSim: confident ? msg.atSim : null,
  });
  if (confident) {
    const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, best.orderId)));
    await transitionOrder(db, sandboxId, order, "DO_ZAMKNIECIA", "ai", `CMR dopasowany (${best.reasons.join(", ")})`, msg.atSim);
    await recordAiAction(db, sandboxId, outcome.logId, { type: "status", orderId: order.id, number: order.number, from: "ROZLADUNEK", to: "DO_ZAMKNIECIA", documentId: docId });
    await resolveAlerts(db, sandboxId, `cmr-missing:${order.id}`, msg.atSim);
    const issues = [!quality.stamp && "brak pieczątki odbiorcy", !quality.signature && "brak podpisu odbiorcy", quality.remarks && `adnotacja: „${quality.remarks}”`].filter(Boolean);
    await openAlert(
      db,
      sandboxId,
      cmrAlert(
        docId,
        issues.length ? "warning" : "info",
        issues.length ? `${order.number}: CMR z uwagami` : `${order.number}: CMR gotowy do zamknięcia`,
        issues.length ? `Sprawdź przed zamknięciem: ${issues.join("; ")}.` : `Dokument pasuje do zlecenia (${best.reasons.join(", ")}). Zamknij zlecenie w Dokumentach.`,
        driverId,
        order.id,
      ),
      msg.atSim,
    );
  } else {
    await openAlert(db, sandboxId, cmrAlert(docId, "info", "CMR do weryfikacji", "AI odczytało dokument, ale nie dopasowało go pewnie do zlecenia. Przypisz go ręcznie.", driverId), msg.atSim);
  }
}

function fieldsOf(r: CmrReading) {
  return { cmr_number: r.cmr_number, sender: r.sender, consignee: r.consignee, place_of_delivery: r.place_of_delivery, delivery_date: r.delivery_date, references: r.references };
}

function cmrAlert(docId: string, severity: "info" | "warning", title: string, body: string, driverId: string, orderId?: string) {
  return { kind: "cmr", severity, dedupeKey: `cmr:${docId}`, title, body, actions: ["otworz_dokument" as const], facts: {}, driverId, orderId: orderId ?? null };
}

async function scheduleBotResend(db: Executor, sandboxId: string, driverId: string, sampleId: string | null, at: Date) {
  const sample = sampleId ? cmrSample(sampleId) : undefined;
  if (!sample?.orderId) return;
  const sharp = samplesForOrder(sample.orderId).find((s) => s.variant === "ostry");
  if (!sharp) return;
  const { scheduleEvent } = await import("../tick/engine");
  await scheduleEvent(db, sandboxId, { dueSim: new Date(at.getTime() + 15 * MIN), type: "bot.cmr", payload: { driverId, sampleId: sharp.id, resend: true } });
}

/** Which photo a simulated driver sends after unloading (spec §10.2: ZL-1038 starts blurry). */
function botVariant(orderId: string, seed: number): CmrVariant | null {
  if (orderId === "zl-1038") return "rozmazany";
  if (orderId === "zl-1033") return "ostry";
  const rng = createRng(seed ^ seedFromString(orderId));
  const roll = rng.next();
  if (roll < 0.1) return null;
  if (roll < 0.2) return "bez-pieczatki";
  if (roll < 0.3) return "uwagi";
  return "ostry";
}

onMovement(async (ctx, { event, order }) => {
  if (event.type !== "departed" || event.stop.purpose !== "delivery" || !order?.driverId) return;
  const at = new Date(event.atMs);
  await ctx.schedule({ dueSim: new Date(at.getTime() + 120 * MIN), type: "cmr.reminder", payload: { orderId: order.id } });
  await ctx.schedule({ dueSim: new Date(at.getTime() + 240 * MIN), type: "cmr.alert", payload: { orderId: order.id } });
  const variant = botVariant(order.id, ctx.sandbox.seed);
  const options = samplesForOrder(order.id);
  const sample = options.find((s) => s.variant === variant) ?? (variant ? options.find((s) => s.variant === "ostry") : undefined);
  if (!sample) return;
  const rng = createRng(ctx.sandbox.seed ^ seedFromString(`cmr:${order.id}`));
  await ctx.schedule({ dueSim: new Date(at.getTime() + rng.int(5, 12) * MIN), type: "bot.cmr", payload: { driverId: order.driverId, sampleId: sample.id } });
});

registerEventHandler("bot.cmr", async (ctx, event) => {
  const p = event.payload as { driverId: string; sampleId: string; resend?: boolean };
  if (ctx.sandbox.phoneDriverId === p.driverId) return;
  const messageId = await storeDriverInbound(ctx.tx, ctx.sandbox.id, {
    driverId: p.driverId,
    body: p.resend ? "Wysyłam jeszcze raz, teraz wyraźniej" : "CMR w załączniku",
    atSim: ctx.simNow,
    attachments: [{ sampleId: p.sampleId }],
  });
  scheduleProcessing(ctx, messageId);
});

/**
 * Did the driver send a usable document for this order? A photo message counts
 * even before it is read (catch-up ticks process it after commit), unless the
 * dispatcher rejected it or it was matched to a different order.
 */
async function hasDocument(db: Executor, sandboxId: string, order: typeof orders.$inferSelect) {
  if (!order.driverId) return false;
  const since = order.arrivedDeliveryAt?.getTime() ?? 0;
  const [docs, photos] = await Promise.all([
    db.select({ messageId: documents.messageId, matchedOrderId: documents.matchedOrderId, status: documents.status }).from(documents).where(eq(documents.sandboxId, sandboxId)),
    db
      .select({ id: messages.id, atSim: messages.atSim, attachments: messages.attachments })
      .from(messages)
      .where(and(eq(messages.sandboxId, sandboxId), eq(messages.driverId, order.driverId), eq(messages.direction, "in"))),
  ]);
  if (docs.some((d) => d.matchedOrderId === order.id && d.status !== "odrzucony")) return true;
  return photos.some((m) => {
    if (m.attachments.length === 0 || m.atSim.getTime() < since) return false;
    const doc = docs.find((d) => d.messageId === m.id);
    return !doc || (doc.status !== "odrzucony" && (doc.matchedOrderId === null || doc.matchedOrderId === order.id));
  });
}

registerEventHandler("cmr.reminder", async (ctx, event) => {
  const { orderId } = event.payload as { orderId: string };
  const [order] = await ctx.tx.select().from(orders).where(and(eq(orders.sandboxId, ctx.sandbox.id), eq(orders.id, orderId)));
  if (!order || order.status !== "ROZLADUNEK" || !order.driverId || (await hasDocument(ctx.tx, ctx.sandbox.id, order))) return;
  await sendToDriver(ctx.tx, ctx.sandbox.id, { driverId: order.driverId, body: cmrMissingSms(order), kind: "cmr_missing", orderId, sentBy: "system", atSim: ctx.simNow });
});

registerEventHandler("cmr.alert", async (ctx, event) => {
  const { orderId } = event.payload as { orderId: string };
  const [order] = await ctx.tx.select().from(orders).where(and(eq(orders.sandboxId, ctx.sandbox.id), eq(orders.id, orderId)));
  if (!order || order.status !== "ROZLADUNEK" || (await hasDocument(ctx.tx, ctx.sandbox.id, order))) return;
  await openAlert(
    ctx.tx,
    ctx.sandbox.id,
    {
      kind: "cmr_missing",
      severity: "info",
      dedupeKey: `cmr-missing:${orderId}`,
      title: `${order.number}: brak CMR`,
      body: "Minęły 4 godziny od rozładunku, a kierowca nie przysłał zdjęcia CMR mimo przypomnienia.",
      actions: ["napisz_do_kierowcy"],
      facts: {},
      orderId,
      driverId: order.driverId,
      vehicleId: order.vehicleId,
    },
    ctx.simNow,
  );
});

onDriverDocument(handleCmrDocument);

// ——— Dispatcher actions ———

async function loadDocument(db: Executor, sandboxId: string, id: string) {
  const [doc] = await db.select().from(documents).where(and(eq(documents.sandboxId, sandboxId), eq(documents.id, id)));
  if (!doc) throw new HttpError(404, "Nie ma takiego dokumentu.");
  return doc;
}

/** Closes the order behind a matched CMR (DO_ZAMKNIECIA → ZAMKNIETE, dispatcher only). */
export async function closeOrderFromDocument(db: Executor, sandboxId: string, documentId: string, simNow: Date) {
  const doc = await loadDocument(db, sandboxId, documentId);
  if (doc.status !== "do_zamkniecia" || !doc.matchedOrderId) throw new HttpError(409, "Ten dokument nie czeka na zamknięcie zlecenia.");
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, doc.matchedOrderId)));
  await transitionOrder(db, sandboxId, order, "ZAMKNIETE", "dispatcher", "Zamknięte po sprawdzeniu CMR", simNow);
  await db.update(documents).set({ status: "zatwierdzony", decidedBy: "dispatcher", decidedAtSim: simNow }).where(and(eq(documents.sandboxId, sandboxId), eq(documents.id, documentId)));
  await resolveAlerts(db, sandboxId, `cmr:${documentId}`, simNow);
  if (order.driverId) {
    await db
      .insert(driverClientHistory)
      .values({ sandboxId, driverId: order.driverId, clientId: order.clientId, completedOrders: 1 })
      .onConflictDoUpdate({
        target: [driverClientHistory.sandboxId, driverClientHistory.driverId, driverClientHistory.clientId],
        set: { completedOrders: sql`${driverClientHistory.completedOrders} + 1` },
      });
  }
}

/** Dispatcher assigns an unmatched CMR to an unloaded order. */
export async function assignDocument(db: Executor, sandboxId: string, documentId: string, orderId: string, simNow: Date) {
  const doc = await loadDocument(db, sandboxId, documentId);
  if (!["do_weryfikacji", "nieczytelny"].includes(doc.status)) throw new HttpError(409, "Ten dokument jest już przypisany.");
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, orderId)));
  if (!order) throw new HttpError(404, "Nie ma takiego zlecenia.");
  await transitionOrder(db, sandboxId, order, "DO_ZAMKNIECIA", "dispatcher", "CMR przypisany ręcznie", simNow);
  await db
    .update(documents)
    .set({ status: "do_zamkniecia", matchedOrderId: orderId, decidedBy: "dispatcher", decidedAtSim: simNow })
    .where(and(eq(documents.sandboxId, sandboxId), eq(documents.id, documentId)));
  await resolveAlerts(db, sandboxId, `cmr:${documentId}`, simNow);
  await resolveAlerts(db, sandboxId, `cmr-missing:${orderId}`, simNow);
}

/** Rejects a document; an order moved by it goes back to ROZLADUNEK. */
export async function rejectDocument(db: Executor, sandboxId: string, documentId: string, simNow: Date) {
  const doc = await loadDocument(db, sandboxId, documentId);
  if (doc.status === "zatwierdzony") throw new HttpError(409, "Zlecenie z tym dokumentem jest już zamknięte.");
  if (doc.status === "do_zamkniecia" && doc.matchedOrderId) {
    const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, doc.matchedOrderId)));
    if (order?.status === "DO_ZAMKNIECIA") await transitionOrder(db, sandboxId, order, "ROZLADUNEK", "dispatcher", "Odrzucone dopasowanie CMR", simNow);
  }
  await db.update(documents).set({ status: "odrzucony", decidedBy: "dispatcher", decidedAtSim: simNow }).where(and(eq(documents.sandboxId, sandboxId), eq(documents.id, documentId)));
  await resolveAlerts(db, sandboxId, `cmr:${documentId}`, simNow);
}

// ——— Views ———

export type DocumentView = {
  id: string;
  status: string;
  imageRef: string | null;
  imageUrl: string | null;
  sampleLabel: string | null;
  driverName: string;
  createdSim: string;
  readBy: string | null;
  note: string | null;
  extracted: Record<string, unknown> | null;
  quality: { legible: boolean; stamp: boolean | null; signature: boolean | null; remarks: string | null } | null;
  matchedOrder: { id: string; number: string; status: string } | null;
  matchScore: number | null;
  candidates: { orderId: string; number: string; score: number; reasons: string[] }[];
  assignable: { id: string; number: string; label: string }[];
};

export async function listDocuments(db: Executor, sandboxId: string): Promise<DocumentView[]> {
  const [docs, drv, ord] = await Promise.all([
    db.select().from(documents).where(eq(documents.sandboxId, sandboxId)),
    db.select().from(drivers).where(eq(drivers.sandboxId, sandboxId)),
    db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), inArray(orders.status, ["ROZLADUNEK", "DO_ZAMKNIECIA", "ZAMKNIETE"]))),
  ]);
  const unloaded = ord.filter((o) => o.status === "ROZLADUNEK");
  return docs
    .sort((a, b) => b.createdSim.getTime() - a.createdSim.getTime())
    .map((d) => {
      const driver = drv.find((x) => x.id === d.driverId);
      const matched = ord.find((o) => o.id === d.matchedOrderId);
      const sample = d.imageRef ? cmrSample(d.imageRef) : undefined;
      return {
        id: d.id,
        status: d.status,
        imageRef: d.imageRef,
        imageUrl: sample?.file ?? null,
        sampleLabel: sample?.label ?? null,
        driverName: driver ? `${driver.firstName} ${driver.lastName}` : "",
        createdSim: d.createdSim.toISOString(),
        readBy: d.readBy,
        note: d.note,
        extracted: d.extracted,
        quality: d.quality,
        matchedOrder: matched ? { id: matched.id, number: matched.number, status: matched.status } : null,
        matchScore: d.matchScore,
        candidates: d.matchCandidates,
        assignable: unloaded
          .sort((a, b) => (a.driverId === d.driverId ? -1 : 0) - (b.driverId === d.driverId ? -1 : 0))
          .map((o) => ({ id: o.id, number: o.number, label: `${o.number}${o.driverId === d.driverId ? " (ten kierowca)" : ""}` })),
      };
    });
}

export async function openDocumentsCount(db: Executor, sandboxId: string): Promise<number> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.sandboxId, sandboxId), inArray(documents.status, ["do_zamkniecia", "do_weryfikacji", "nieczytelny"])));
  return rows.length;
}
