import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { clients, documents, driverLinks, messages, orders, points, type OrderStatus } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { CARRIER_DISPATCH_PHONE, CARRIER_NAME } from "@/domain/carrier";
import { COUNTRY_NAMES } from "@/domain/countries";
import { windowText } from "@/domain/sms-templates";
import { samplesForOrder } from "@/simulation/scenario/cmr-samples";
import { openAlert } from "../alerts/repository";
import { config } from "../config";
import { HttpError } from "../http";
import { storeDriverInbound } from "../messages/gateway";
import { processDriverInbound, type UploadedImage } from "../messages/inbound";
import { transitionOrder } from "../orders/transition";
import { getSandbox } from "../sandbox/repository";
import { runTick } from "../tick/engine";

/** Where the order stands from the driver's point of view. */
export type DriverLinkState = "do_potwierdzenia" | "potwierdzone" | "zaladunek" | "w_drodze" | "rozladunek" | "zakonczone" | "odwolane";

type Stop = { name: string; address: string; city: string; country: string; window: string; remarks: string; lat: number; lng: number };

/** What the driver's page shows: this order only — no other orders, no client contacts. */
export type DriverOrderView = {
  carrier: string;
  dispatchPhone: string;
  number: string;
  clientName: string;
  state: DriverLinkState;
  pickup: Stop;
  delivery: Stop;
  cargo: string;
  references: string[];
  notes: string;
  /** "przyjete": a photo for this order arrived; "do_poprawy": the last photo could not be read. */
  cmr: "brak" | "przyjete" | "do_poprawy";
  /** Demo only: sample CMR photos of this order, for visitors without a real document at hand. */
  samples: { id: string; label: string }[];
};

type OrderRow = typeof orders.$inferSelect;
type LinkRow = typeof driverLinks.$inferSelect;

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const REFUSAL_REASONS = ["Auto niesprawne", "Brak czasu pracy", "Choroba lub sprawa osobista", "Inny powód"] as const;

/** Creates the link that goes into the order SMS and returns its full address. */
export async function createDriverLink(db: Executor, sandboxId: string, orderId: string, driverId: string, simNow: Date): Promise<string> {
  const token = randomBytes(12).toString("base64url");
  await db.insert(driverLinks).values({ token, sandboxId, orderId, driverId, createdSim: simNow });
  return `${config.appUrl}/k/${token}`;
}

const STATE: Partial<Record<OrderStatus, DriverLinkState>> = {
  WYSLANE: "do_potwierdzenia",
  POTWIERDZONE: "potwierdzone",
  ZALADUNEK: "zaladunek",
  W_DRODZE: "w_drodze",
  ROZLADUNEK: "rozladunek",
  DO_ZAMKNIECIA: "zakonczone",
  ZAMKNIETE: "zakonczone",
};

/** The link only works while the order is still this driver's: after a reassignment or cancellation it says so. */
export function driverLinkState(order: Pick<OrderRow, "status" | "driverId">, link: Pick<LinkRow, "driverId">): DriverLinkState {
  if (order.driverId !== link.driverId) return "odwolane";
  return STATE[order.status] ?? "odwolane";
}

async function resolve(db: Db, token: string, realNow: Date) {
  if (!TOKEN_RE.test(token)) throw new HttpError(404, "Nie ma takiego linku.");
  const [link] = await db.select().from(driverLinks).where(eq(driverLinks.token, token));
  if (!link) throw new HttpError(404, "Nie ma takiego linku.");
  const sandbox = await getSandbox(db, link.sandboxId);
  if (!sandbox) throw new HttpError(404, "Ten link wygasł razem ze światem demo.");
  const { simNow } = await runTick(db, sandbox.id, realNow);
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, link.orderId)));
  if (!order) throw new HttpError(404, "Nie ma takiego zlecenia.");
  return { link, sandboxId: sandbox.id, simNow, order, state: driverLinkState(order, link) };
}

async function buildView(db: Executor, sandboxId: string, order: OrderRow, link: LinkRow): Promise<DriverOrderView> {
  const state = driverLinkState(order, link);
  const [client] = await db.select({ name: clients.name }).from(clients).where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, order.clientId)));
  const pts = await db.select().from(points).where(eq(points.sandboxId, sandboxId));
  const stop = (pointId: string, from: Date, to: Date): Stop => {
    const p = pts.find((x) => x.id === pointId);
    return {
      name: p?.name ?? "",
      address: p?.address ?? "",
      city: p?.city ?? "",
      country: p ? COUNTRY_NAMES[p.country] : "",
      window: windowText(from, to),
      remarks: [p?.requirements, p?.notes].filter(Boolean).join(". "),
      lat: p?.lat ?? 0,
      lng: p?.lng ?? 0,
    };
  };
  const cargo = [`${order.cargoPallets} palet`, `${order.cargoKg} kg`];
  if (order.bodyRequired === "chlodnia") cargo.push("chłodnia");
  if (order.adrRequired) cargo.push("ADR");

  // A photo matched to this order counts as received; otherwise an unreadable last photo asks for a retake.
  const docs = await db
    .select({ status: documents.status, matchedOrderId: documents.matchedOrderId, createdSim: documents.createdSim })
    .from(documents)
    .where(and(eq(documents.sandboxId, sandboxId), eq(documents.driverId, link.driverId)))
    .orderBy(desc(documents.createdSim));
  const sinceUnloading = order.arrivedDeliveryAt ?? order.createdSim;
  const cmr = docs.some((d) => d.matchedOrderId === order.id) ? "przyjete" : docs[0]?.status === "nieczytelny" && docs[0].createdSim >= sinceUnloading ? "do_poprawy" : "brak";

  // A revoked link tells the driver only that the order is off — nothing about where it goes now.
  const hidden = state === "odwolane";
  return {
    carrier: CARRIER_NAME,
    dispatchPhone: CARRIER_DISPATCH_PHONE,
    number: order.number,
    clientName: hidden ? "" : (client?.name ?? ""),
    state,
    pickup: hidden ? stop("", order.pickupFrom, order.pickupTo) : stop(order.pickupPointId, order.pickupFrom, order.pickupTo),
    delivery: hidden ? stop("", order.deliveryFrom, order.deliveryTo) : stop(order.deliveryPointId, order.deliveryFrom, order.deliveryTo),
    cargo: hidden ? "" : cargo.join(", "),
    references: hidden ? [] : order.references,
    notes: hidden ? "" : order.notes,
    cmr: hidden ? "brak" : cmr,
    samples: state === "rozladunek" ? samplesForOrder(order.id).map((s) => ({ id: s.id, label: s.label })) : [],
  };
}

/** Public read by token (no demo world cookie). Advances that world to "now" first. */
export async function driverOrderView(db: Db, token: string, realNow: Date): Promise<DriverOrderView> {
  const { link, sandboxId, order } = await resolve(db, token, realNow);
  return buildView(db, sandboxId, order, link);
}

/** Stores what the driver did on the page as a message in their thread, already classified (no AI needed). */
async function logDriverAction(db: Executor, sandboxId: string, input: { driverId: string; orderId: string; body: string; category: string; summary: string; atSim: Date }) {
  const messageId = await storeDriverInbound(db, sandboxId, { driverId: input.driverId, body: input.body, atSim: input.atSim });
  await db
    .update(messages)
    .set({ aiCategory: input.category, aiSummary: input.summary, aiConfidence: 1, classifiedBy: "rules", orderId: input.orderId })
    .where(and(eq(messages.sandboxId, sandboxId), eq(messages.id, messageId)));
  return messageId;
}

const refetch = async (db: Db, sandboxId: string, link: LinkRow) => {
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, link.orderId)));
  return buildView(db, sandboxId, order, link);
};

/** "Potwierdzam": WYSLANE → POTWIERDZONE by the driver, visible to the dispatcher like an SMS confirmation. */
export async function confirmByDriver(db: Db, token: string, realNow: Date): Promise<DriverOrderView> {
  const { link, sandboxId, simNow, order, state } = await resolve(db, token, realNow);
  if (state === "odwolane") throw new HttpError(409, "To zlecenie zostało odwołane. Nie jedź na załadunek.");
  // A second tap (or a tap after confirming by SMS) is not an error for the driver.
  if (state !== "do_potwierdzenia") return buildView(db, sandboxId, order, link);
  const messageId = await logDriverAction(db, sandboxId, {
    driverId: link.driverId,
    orderId: order.id,
    body: `Potwierdzam zlecenie ${order.number}. (ze strony zlecenia)`,
    category: "potwierdzenie",
    summary: "Kierowca potwierdził zlecenie na stronie zlecenia.",
    atSim: simNow,
  });
  await transitionOrder(db, sandboxId, order, "POTWIERDZONE", "driver", "Kierowca potwierdził na stronie zlecenia", simNow);
  await openAlert(
    db,
    sandboxId,
    {
      kind: "order_confirmed",
      severity: "info",
      dedupeKey: `msg:${messageId}`,
      title: `${order.number}: kierowca potwierdził zlecenie`,
      body: "Potwierdzenie ze strony zlecenia (link z SMS-a). Zlecenie jest w realizacji.",
      actions: ["brak"],
      facts: { kanal: "strona zlecenia" },
      driverId: link.driverId,
      vehicleId: order.vehicleId,
      orderId: order.id,
      messageId,
    },
    simNow,
  );
  return refetch(db, sandboxId, link);
}

/** "Nie mogę jechać": the order goes back to the pool and the dispatcher gets an alert with the reason. */
export async function refuseByDriver(db: Db, token: string, reason: string, realNow: Date): Promise<DriverOrderView> {
  const { link, sandboxId, simNow, order, state } = await resolve(db, token, realNow);
  if (state === "odwolane") return buildView(db, sandboxId, order, link);
  if (state !== "do_potwierdzenia") throw new HttpError(409, "To zlecenie jest już potwierdzone. Jeśli nie możesz jechać, zadzwoń do spedycji.");
  const messageId = await logDriverAction(db, sandboxId, {
    driverId: link.driverId,
    orderId: order.id,
    body: `Nie mogę wziąć zlecenia ${order.number}. Powód: ${reason}. (ze strony zlecenia)`,
    category: "odmowa",
    summary: `Kierowca odmówił na stronie zlecenia: ${reason}.`,
    atSim: simNow,
  });
  await transitionOrder(db, sandboxId, order, "NOWE", "system", `Odmowa kierowcy na stronie zlecenia: ${reason}`, simNow, { driverId: null, vehicleId: null, trailerId: null });
  await openAlert(
    db,
    sandboxId,
    {
      kind: "order_refused",
      severity: "warning",
      dedupeKey: `msg:${messageId}`,
      title: `${order.number}: kierowca odmówił`,
      body: `Powód: ${reason}. Zlecenie wróciło do puli — wybierz innego kierowcę.`,
      actions: ["przydziel_innego", "napisz_do_kierowcy"],
      facts: { kanal: "strona zlecenia", powod: reason },
      driverId: link.driverId,
      vehicleId: order.vehicleId,
      orderId: order.id,
      messageId,
    },
    simNow,
  );
  return refetch(db, sandboxId, link);
}

/** CMR photo from the page: the same path as an MMS (AI reads it, matches it to the order, the dispatcher decides). */
export async function cmrByDriver(db: Db, token: string, photo: { uploaded: UploadedImage; name: string } | { sampleId: string }, realNow: Date): Promise<DriverOrderView> {
  const { link, sandboxId, simNow, order, state } = await resolve(db, token, realNow);
  if (state === "odwolane") throw new HttpError(409, "To zlecenie zostało odwołane.");
  if (state === "zakonczone") return buildView(db, sandboxId, order, link);
  if (state !== "rozladunek") throw new HttpError(409, "Zdjęcie CMR wyślij po rozładunku, kiedy dokument jest podpisany.");
  if ("sampleId" in photo && !samplesForOrder(order.id).some((s) => s.id === photo.sampleId)) throw new HttpError(400, "Nie ma takiego przykładowego zdjęcia dla tego zlecenia.");
  const messageId = await storeDriverInbound(db, sandboxId, {
    driverId: link.driverId,
    body: "CMR w załączniku (ze strony zlecenia)",
    atSim: simNow,
    attachments: "sampleId" in photo ? [{ sampleId: photo.sampleId }] : [{ notStored: true, name: photo.name.slice(0, 80) }],
  });
  await processDriverInbound(db, sandboxId, messageId, { simNow, uploaded: "uploaded" in photo ? photo.uploaded : undefined });
  return refetch(db, sandboxId, link);
}
