import type { OrderStatus, StatusActor } from "@/db/schema";
import { ACTOR_LABEL, STATUS_LABEL } from "./order-lifecycle";

/** One recorded status change, as the database keeps it. */
export type StatusChange = {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actor: StatusActor;
  reason: string;
  atSim: Date;
};

/** How far along its life an order is: a change to a lower rank is a step back (e.g. the order returned to the pool). */
const RANK: Record<OrderStatus, number> = {
  SZKIC: 0,
  NOWE: 1,
  PRZYPISANE: 2,
  WYSLANE: 3,
  POTWIERDZONE: 4,
  ZALADUNEK: 5,
  W_DRODZE: 6,
  ROZLADUNEK: 7,
  DO_ZAMKNIECIA: 8,
  ZAMKNIETE: 9,
  ANULOWANE: 9,
};

export type HistoryKind = "start" | "forward" | "back" | "closed" | "cancelled";

export type HistoryEntry = {
  id: string;
  at: string;
  /** Status label before the change; null for the entry that created the order. */
  from: string | null;
  to: string;
  status: OrderStatus;
  actor: StatusActor;
  actorLabel: string;
  reason: string;
  kind: HistoryKind;
  /** Minutes since the previous entry; null for the first one. */
  sincePrevMin: number | null;
};

/**
 * Oldest first. Two changes can carry the same timestamp (assignment and the order SMS happen in one step),
 * and their ids are random — so within one moment the order follows the chain: each change starts where the previous ended.
 */
export function sortChanges<T extends Pick<StatusChange, "fromStatus" | "toStatus" | "atSim">>(changes: T[]): T[] {
  const byTime = [...changes].sort((a, b) => a.atSim.getTime() - b.atSim.getTime());
  const out: T[] = [];
  let i = 0;
  while (i < byTime.length) {
    let j = i;
    while (j < byTime.length && byTime[j].atSim.getTime() === byTime[i].atSim.getTime()) j++;
    const moment = byTime.slice(i, j);
    let last: OrderStatus | null = out.length > 0 ? out[out.length - 1].toStatus : null;
    while (moment.length > 0) {
      const next = Math.max(0, moment.findIndex((c) => c.fromStatus === last));
      const [change] = moment.splice(next, 1);
      out.push(change);
      last = change.toStatus;
    }
    i = j;
  }
  return out;
}

function kindOf(change: Pick<StatusChange, "fromStatus" | "toStatus">): HistoryKind {
  if (change.fromStatus === null) return "start";
  if (change.toStatus === "ANULOWANE") return "cancelled";
  if (change.toStatus === "ZAMKNIETE") return "closed";
  return RANK[change.toStatus] < RANK[change.fromStatus] ? "back" : "forward";
}

export function historyEntries(changes: StatusChange[]): HistoryEntry[] {
  const sorted = sortChanges(changes);
  return sorted.map((c, i) => ({
    id: c.id,
    at: c.atSim.toISOString(),
    from: c.fromStatus ? STATUS_LABEL[c.fromStatus] : null,
    to: STATUS_LABEL[c.toStatus],
    status: c.toStatus,
    actor: c.actor,
    actorLabel: ACTOR_LABEL[c.actor],
    reason: c.reason,
    kind: kindOf(c),
    sincePrevMin: i === 0 ? null : Math.round((c.atSim.getTime() - sorted[i - 1].atSim.getTime()) / 60_000),
  }));
}

/** "35 min", "2 h 15 min", "1 d 4 h" — coarse on purpose: a timeline is read at a glance. */
export function durationLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d} d` : `${d} d ${h % 24} h`;
}

export type HistorySummary = {
  /** Minutes from the first to the last recorded change; null when there is at most one. */
  totalMin: number | null;
  /** How many times the order went a step back (refusal, withdrawn assignment, rejected CMR match…). */
  stepsBack: number;
};

export function historySummary(entries: HistoryEntry[]): HistorySummary {
  const totalMin = entries.length < 2 ? null : Math.round((Date.parse(entries[entries.length - 1].at) - Date.parse(entries[0].at)) / 60_000);
  return { totalMin, stepsBack: entries.filter((e) => e.kind === "back").length };
}
