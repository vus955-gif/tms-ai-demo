import type { scheduledEvents } from "@/db/schema";
import type { Db, Tx } from "@/db/types";
import type { Rng } from "@/simulation/random";
import type { SandboxRow } from "../sandbox/repository";

export type ScheduledEventRow = typeof scheduledEvents.$inferSelect;

export type NewScheduledEvent = {
  dueSim: Date;
  type: string;
  payload?: Record<string, unknown>;
};

export type TickContext = {
  tx: Tx;
  sandbox: SandboxRow;
  /** Simulation time this tick advances to. */
  simNow: Date;
  /** Simulation time reached by the previous tick. */
  previousSim: Date;
  realNow: Date;
  rng: Rng;
  /** True when an item is so old that nobody watched it happen (skip AI, use templates). */
  isStale(at: Date): boolean;
  schedule(event: NewScheduledEvent): Promise<void>;
  /** Work to run after the transaction commits (e.g. slow AI calls). */
  afterCommit(task: (db: Db) => Promise<void>): void;
};

export type EventHandler = (ctx: TickContext, event: ScheduledEventRow) => Promise<void>;
/** Runs once per tick after events, e.g. plan progress and risk evaluation. */
export type TickPhase = (ctx: TickContext) => Promise<void>;

const handlers = new Map<string, EventHandler>();
const phases: { name: string; run: TickPhase }[] = [];

export function registerEventHandler(type: string, handler: EventHandler) {
  handlers.set(type, handler);
}

export function getEventHandler(type: string): EventHandler | undefined {
  return handlers.get(type);
}

export function registerTickPhase(name: string, run: TickPhase) {
  const existing = phases.findIndex((p) => p.name === name);
  if (existing >= 0) phases[existing] = { name, run };
  else phases.push({ name, run });
}

export function getTickPhases(): readonly { name: string; run: TickPhase }[] {
  return phases;
}
