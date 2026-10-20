import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { clients, orders, trackingLinks } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { getRouteByKey } from "@/adapters/routing/static-routes";
import { isApproxRoute } from "@/simulation/approx-route";
import { CARRIER_NAME } from "@/domain/carrier";
import { type ClientView } from "@/domain/client-view";
import { sliceCoordinates } from "@/simulation/geo";
import { HttpError } from "../http";
import { buildClientView } from "../inbox/client-facts";
import { loadFleet } from "../monitoring/fleet-data";
import { getSandbox } from "../sandbox/repository";
import { runTick } from "../tick/engine";

const MIN = 60_000;
export const EXTEND_STEP_MIN = 120;

export type TrackingState = "przed" | "aktywny" | "zakonczony" | "wylaczony";
type LinkRow = typeof trackingLinks.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

/**
 * Visibility window (spec stage 5 §2.3): from the earlier of ETD and the actual
 * departure from loading, until the agreed ETA plus the dispatcher's extensions.
 */
export function trackingWindow(order: Pick<OrderRow, "etd" | "pickupTo" | "departedPickupAt" | "etaAgreed" | "deliveryTo">, extendedMinutes: number) {
  const etd = (order.etd ?? order.pickupTo).getTime();
  const departed = order.departedPickupAt?.getTime() ?? Infinity;
  const from = new Date(Math.min(etd, departed));
  const to = new Date((order.etaAgreed ?? order.deliveryTo).getTime() + extendedMinutes * MIN);
  return { from, to };
}

export function trackingState(link: Pick<LinkRow, "revoked" | "extendedMinutes">, order: Parameters<typeof trackingWindow>[0], simNow: Date): TrackingState {
  if (link.revoked) return "wylaczony";
  const w = trackingWindow(order, link.extendedMinutes);
  if (simNow < w.from) return "przed";
  if (simNow > w.to) return "zakonczony";
  return "aktywny";
}

export type LinkView = { token: string; state: TrackingState; from: string; to: string; extendedMinutes: number; path: string; etaLate: boolean };

async function loadOrder(db: Executor, sandboxId: string, orderId: string) {
  const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandboxId), eq(orders.id, orderId)));
  if (!order) throw new HttpError(404, "Nie ma takiego zlecenia.");
  return order;
}

export async function activeLink(db: Executor, sandboxId: string, orderId: string) {
  const [link] = await db
    .select()
    .from(trackingLinks)
    .where(and(eq(trackingLinks.sandboxId, sandboxId), eq(trackingLinks.orderId, orderId), eq(trackingLinks.revoked, false)))
    .orderBy(desc(trackingLinks.createdSim));
  return link ?? null;
}

export function linkView(link: LinkRow, order: OrderRow, simNow: Date): LinkView {
  const w = trackingWindow(order, link.extendedMinutes);
  return {
    token: link.token,
    state: trackingState(link, order, simNow),
    from: w.from.toISOString(),
    to: w.to.toISOString(),
    extendedMinutes: link.extendedMinutes,
    path: `/sledzenie/${link.token}`,
    // The forecast is past the end of visibility: the dispatcher should extend it.
    etaLate: Boolean(order.etaPredicted && order.etaPredicted > w.to),
  };
}

export async function linkForOrder(db: Executor, sandboxId: string, orderId: string, simNow: Date): Promise<LinkView | null> {
  const order = await loadOrder(db, sandboxId, orderId);
  const link = await activeLink(db, sandboxId, orderId);
  return link ? linkView(link, order, simNow) : null;
}

export async function createLink(db: Executor, sandboxId: string, orderId: string, simNow: Date): Promise<LinkView> {
  const order = await loadOrder(db, sandboxId, orderId);
  if (["SZKIC", "ANULOWANE"].includes(order.status)) throw new HttpError(409, "Tego zlecenia nie można udostępnić klientowi.");
  const existing = await activeLink(db, sandboxId, orderId);
  if (existing) return linkView(existing, order, simNow);
  const token = randomBytes(18).toString("base64url");
  await db.insert(trackingLinks).values({ token, sandboxId, orderId, clientId: order.clientId, createdSim: simNow });
  return linkView((await activeLink(db, sandboxId, orderId))!, order, simNow);
}

export async function extendLink(db: Executor, sandboxId: string, orderId: string, simNow: Date): Promise<LinkView> {
  const order = await loadOrder(db, sandboxId, orderId);
  const link = await activeLink(db, sandboxId, orderId);
  if (!link) throw new HttpError(409, "To zlecenie nie ma aktywnego linku.");
  await db.update(trackingLinks).set({ extendedMinutes: link.extendedMinutes + EXTEND_STEP_MIN }).where(eq(trackingLinks.token, link.token));
  return linkView({ ...link, extendedMinutes: link.extendedMinutes + EXTEND_STEP_MIN }, order, simNow);
}

export async function revokeLink(db: Executor, sandboxId: string, orderId: string) {
  const link = await activeLink(db, sandboxId, orderId);
  if (!link) throw new HttpError(409, "To zlecenie nie ma aktywnego linku.");
  await db.update(trackingLinks).set({ revoked: true }).where(eq(trackingLinks.token, link.token));
}

/** What the public tracking page shows: clientView + position, nothing about the driver. */
export type PublicTracking = {
  carrier: string;
  clientName: string;
  state: TrackingState;
  window: { from: string; to: string };
  view: ClientView | null;
  position: { lng: number; lat: number; at: string } | null;
  route: [number, number][] | null;
  /** The leg runs to a point added in the app: the line on the map is indicative, not the road. */
  approximateRoute: boolean;
  simNow: string;
};

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Public read by token (no demo world cookie). Advances that world to "now" first. */
export async function publicTracking(db: Db, token: string, realNow: Date): Promise<PublicTracking> {
  if (!TOKEN_RE.test(token)) throw new HttpError(404, "Nie ma takiego linku.");
  const [link] = await db.select().from(trackingLinks).where(eq(trackingLinks.token, token));
  if (!link) throw new HttpError(404, "Nie ma takiego linku.");
  const sandbox = await getSandbox(db, link.sandboxId);
  if (!sandbox) throw new HttpError(404, "Ten link wygasł razem ze światem demo.");
  const { simNow } = link.revoked ? { simNow: sandbox.lastTickSim } : await runTick(db, sandbox.id, realNow);
  const order = await loadOrder(db, sandbox.id, link.orderId);
  const [client] = await db.select({ name: clients.name }).from(clients).where(and(eq(clients.sandboxId, sandbox.id), eq(clients.id, link.clientId)));
  const state = trackingState(link, order, simNow);
  const w = trackingWindow(order, link.extendedMinutes);
  const base = { carrier: CARRIER_NAME, clientName: client?.name ?? "", state, window: { from: w.from.toISOString(), to: w.to.toISOString() }, simNow: simNow.toISOString() };
  if (state !== "aktywny") return { ...base, view: state === "wylaczony" ? null : await buildClientView(db, sandbox.id, order.id), position: null, route: null, approximateRoute: false };

  const fleet = await loadFleet(db, sandbox.id);
  const vehicleState = order.vehicleId ? fleet.states.get(order.vehicleId) : undefined;
  const onThisOrder = vehicleState && vehicleState.orderId === order.id;
  const position =
    onThisOrder && vehicleState.lastReportLng !== null && vehicleState.lastReportLat !== null
      ? { lng: vehicleState.lastReportLng, lat: vehicleState.lastReportLat, at: (vehicleState.lastReportAt ?? simNow).toISOString() }
      : null;
  const leg = onThisOrder && vehicleState.routeKey && vehicleState.legPurpose === "to_delivery" ? getRouteByKey(vehicleState.routeKey) : null;
  const route = leg ? sliceCoordinates(leg, vehicleState!.lastReportProgressS ?? vehicleState!.progressS, leg.durationS) : null;
  return { ...base, view: await buildClientView(db, sandbox.id, order.id), position, route, approximateRoute: leg ? isApproxRoute(leg) : false };
}

/** Demo "client account": transports shared with one client (never the whole fleet). */
export async function sharedWithClient(db: Executor, sandboxId: string, clientId: string, simNow: Date) {
  const links = await db
    .select()
    .from(trackingLinks)
    .where(and(eq(trackingLinks.sandboxId, sandboxId), eq(trackingLinks.clientId, clientId), eq(trackingLinks.revoked, false)));
  const rows = await db.select().from(orders).where(eq(orders.sandboxId, sandboxId));
  return links
    .map((l) => {
      const order = rows.find((o) => o.id === l.orderId)!;
      return { number: order.number, references: order.references, ...linkView(l, order, simNow) };
    })
    .sort((a, b) => a.from.localeCompare(b.from));
}
