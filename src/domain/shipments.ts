/**
 * Sea, air and rail shipments handled by partner agents: the milestone plan, the
 * lane drawn on the map, and when to ask the agent and update the client.
 * What the forwarder knows comes from agent replies — live positions (flight
 * trackers, AIS) are not connected in the demo (provider costs; see docs/sledzenie-przesylek.md).
 * Pure functions: the server stores the results, the UI shows them.
 */

export type ShipmentMode = "sea" | "air" | "rail";
export type MilestoneKind = "booking" | "terminal_in" | "departed" | "transshipment" | "border" | "arrived" | "customs" | "delivered";

export const MODE_LABEL: Record<ShipmentMode, string> = { sea: "morska", air: "lotnicza", rail: "kolejowa" };
/** "status przesyłki morskiej" */
export const MODE_LABEL_GEN: Record<ShipmentMode, string> = { sea: "morskiej", air: "lotniczej", rail: "kolejowej" };
/** "nie obsługuje transportu morskiego" */
export const MODE_TRANSPORT_GEN: Record<ShipmentMode, string> = { sea: "transportu morskiego", air: "transportu lotniczego", rail: "transportu kolejowego" };

const H = 3_600_000;
const D = 24 * H;

type PlanStep = { kind: MilestoneKind; label: Record<ShipmentMode, string>; offset: (etd: number, eta: number) => number };

const LABELS: Record<MilestoneKind, Record<ShipmentMode, string>> = {
  booking: { sea: "Booking potwierdzony", air: "Booking potwierdzony", rail: "Booking potwierdzony" },
  terminal_in: { sea: "Kontener w porcie załadunku", air: "Przyjęcie w terminalu cargo", rail: "Załadunek na terminalu" },
  departed: { sea: "Statek wypłynął", air: "Odlot", rail: "Odjazd pociągu" },
  transshipment: { sea: "Przeładunek", air: "Przesiadka", rail: "Przeładunek" },
  border: { sea: "Granica", air: "Granica", rail: "Przejście graniczne" },
  arrived: { sea: "Statek w porcie docelowym", air: "Przylot", rail: "Przyjazd na terminal" },
  customs: { sea: "Odprawa celna", air: "Odprawa celna", rail: "Odprawa celna" },
  delivered: { sea: "Wydanie / dostawa", air: "Wydanie / dostawa", rail: "Dostawa" },
};

const step = (kind: MilestoneKind, offset: PlanStep["offset"]): PlanStep => ({ kind, label: LABELS[kind], offset });

/** Typical lead times around departure and arrival; the middle stop sits where the route says. */
const PLAN: Record<ShipmentMode, PlanStep[]> = {
  sea: [
    step("booking", (etd) => etd - 10 * D),
    step("terminal_in", (etd) => etd - 3 * D),
    step("departed", (etd) => etd),
    step("arrived", (_, eta) => eta),
    step("customs", (_, eta) => eta + 1 * D),
    step("delivered", (_, eta) => eta + 3 * D),
  ],
  air: [
    step("booking", (etd) => etd - 3 * D),
    step("terminal_in", (etd) => etd - 1 * D),
    step("departed", (etd) => etd),
    step("arrived", (_, eta) => eta),
    step("customs", (_, eta) => eta + 8 * H),
    step("delivered", (_, eta) => eta + 1 * D),
  ],
  rail: [
    step("booking", (etd) => etd - 7 * D),
    step("terminal_in", (etd) => etd - 2 * D),
    step("departed", (etd) => etd),
    step("arrived", (_, eta) => eta),
    step("customs", (_, eta) => eta + 1 * D),
    step("delivered", (_, eta) => eta + 2 * D),
  ],
};

export type PlannedMilestone = { seq: number; kind: MilestoneKind; label: string; location: string; plannedMs: number };

/**
 * The plan of a shipment. A middle stop (sea/air transshipment, rail border) is
 * placed at `middle.fraction` of the transit time between departure and arrival.
 */
export function planMilestones(
  mode: ShipmentMode,
  etdMs: number,
  etaMs: number,
  places: { origin: string; destination: string; middle?: { name: string; fraction: number } },
): PlannedMilestone[] {
  const out: Omit<PlannedMilestone, "seq">[] = PLAN[mode].map((s) => ({
    kind: s.kind,
    label: s.label[mode],
    location: ["booking", "terminal_in", "departed"].includes(s.kind) ? places.origin : places.destination,
    plannedMs: s.offset(etdMs, etaMs),
  }));
  if (places.middle) {
    const kind: MilestoneKind = mode === "rail" ? "border" : "transshipment";
    const at = etdMs + (etaMs - etdMs) * Math.min(Math.max(places.middle.fraction, 0.05), 0.95);
    out.splice(out.findIndex((m) => m.kind === "arrived"), 0, { kind, label: LABELS[kind][mode], location: places.middle.name, plannedMs: at });
  }
  return out.map((m, i) => ({ ...m, seq: i }));
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

function haversine(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Point at fraction `f` of the great circle from a to b (planes fly arcs, not straight map lines). */
export function greatCirclePoint(a: [number, number], b: [number, number], f: number): [number, number] {
  const [lng1, lat1, lng2, lat2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
  const d = haversine(a, b) / R;
  if (d < 1e-9) return a;
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
  const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return [deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.sqrt(x * x + y * y)))];
}

/** A path for the map: great-circle arcs between waypoints, densified so they look like arcs. */
export function densifyPath(waypoints: [number, number][], stepKm = 150): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const n = Math.max(1, Math.ceil(haversine(waypoints[i], waypoints[i + 1]) / 1000 / stepKm));
    for (let k = 0; k < n; k++) out.push(greatCirclePoint(waypoints[i], waypoints[i + 1], k / n));
  }
  if (waypoints.length > 0) out.push(waypoints[waypoints.length - 1]);
  return out.map(([lng, lat]) => [Math.round(lng * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]);
}

/** Point at fraction `f` of the path length (e.g. where a transshipment or border crossing sits on the lane). */
export function positionOnPath(path: [number, number][], f: number): [number, number] | null {
  if (path.length === 0) return null;
  if (path.length === 1 || f <= 0) return path[0];
  if (f >= 1) return path[path.length - 1];
  const seg = path.slice(1).map((p, i) => haversine(path[i], p));
  const total = seg.reduce((s, x) => s + x, 0);
  let left = Math.min(f, 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) return greatCirclePoint(path[i], path[i + 1], seg[i] === 0 ? 0 : Math.min(left / seg[i], 1));
    left -= seg[i];
  }
  return path[path.length - 1];
}

/** How often to ask the agent for a status, by mode (air moves fast, sea slowly). */
export const AGENT_EVERY_HOURS: Record<ShipmentMode, number> = { air: 12, rail: 24, sea: 48 };
/** Default rhythm of client updates, by mode. */
export const CLIENT_EVERY_HOURS: Record<ShipmentMode, number> = { air: 12, rail: 24, sea: 48 };
/** An unanswered status request gets a reminder after this long; after another such wait the forwarder is told. */
export const AGENT_REMIND_AFTER_H: Record<ShipmentMode, number> = { air: 4, rail: 8, sea: 8 };
/** A planned milestone this late without news is worth asking about straight away. */
export const OVERDUE_ASK_AFTER_MS = 2 * H;

const AFTER_DEPARTURE: MilestoneKind[] = ["transshipment", "border", "arrived", "customs", "delivered"];

/**
 * Next time to ask the agent: the regular rhythm (hours, per shipment), or sooner when a
 * planned milestone has passed without news. "Planned" already counts the delay the agent
 * reported (a ship 52 h late is not overdue at its old time), a milestone before a later
 * confirmed one is not chased (the agent just did not mention it), and repeated asking
 * about the same overdue milestone waits at least half the rhythm (min. 4 h).
 */
export function nextAgentRequestMs(
  everyHours: number,
  lastRequestMs: number | null,
  milestones: { kind?: MilestoneKind; seq?: number; plannedMs: number; actualMs: number | null }[],
  nowMs: number,
  reportedDelayMs = 0,
): number {
  const regular = (lastRequestMs ?? nowMs - everyHours * H) + everyHours * H;
  const lastConfirmedSeq = Math.max(-1, ...milestones.map((m, i) => (m.actualMs !== null ? (m.seq ?? i) : -1)));
  const gap = Math.max(4, everyHours / 2) * H;
  const overdue = milestones
    .map((m, i) => ({ ...m, seq: m.seq ?? i, expectedMs: m.plannedMs + (m.kind && AFTER_DEPARTURE.includes(m.kind) ? Math.max(0, reportedDelayMs) : 0) }))
    .filter((m) => m.actualMs === null && m.seq > lastConfirmedSeq && m.expectedMs + OVERDUE_ASK_AFTER_MS <= nowMs)
    .map((m) => {
      const overdueSince = m.expectedMs + OVERDUE_ASK_AFTER_MS;
      // Not asked since it became overdue: ask now (4 h after any request). Asked already: wait longer.
      const askedAboutIt = lastRequestMs !== null && lastRequestMs >= overdueSince;
      return Math.max(overdueSince, (lastRequestMs ?? 0) + (askedAboutIt ? gap : 4 * H));
    });
  return Math.min(regular, ...overdue);
}

export type ClientUpdateState = "ok" | "wkrotce" | "po_terminie";
/** Remind the forwarder this long before a client update is due. */
export const CLIENT_REMIND_BEFORE_MS = 2 * H;

export function clientUpdateState(nextDueMs: number | null, nowMs: number): ClientUpdateState {
  if (nextDueMs === null) return "ok";
  if (nowMs >= nextDueMs) return "po_terminie";
  return nextDueMs - nowMs <= CLIENT_REMIND_BEFORE_MS ? "wkrotce" : "ok";
}

/** Delay of the current ETA against the plan, in whole hours (positive = late). */
export function etaDelayHours(plannedEtaMs: number, currentEtaMs: number): number {
  return Math.round((currentEtaMs - plannedEtaMs) / H);
}
