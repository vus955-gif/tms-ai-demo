import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { couplings, fleetTerms, orders, points, trailers, vehicles, vehicleStates, type OrderStatus } from "@/db/schema";
import { uniqueViolation } from "@/db/errors";
import type { Db, Executor } from "@/db/types";
import { TERM_LABEL, termStatus } from "@/domain/fleet-terms";
import { checkDrop, checkHook, type SwapCheck, type SwapInput, type SwapTrailer } from "@/domain/trailer-swap";
import { HttpError } from "../http";
import { ensureFleetFile } from "./seed";

/** Cargo is in the trailer from loading until it is unloaded. */
const IN_PROGRESS: OrderStatus[] = ["ZALADUNEK", "W_DRODZE", "ROZLADUNEK"];
/** Assigned to the tractor but not started: these follow the trailer swap. */
const ASSIGNED: OrderStatus[] = ["PRZYPISANE", "WYSLANE", "POTWIERDZONE"];

type Sandbox = { id: string; simOrigin: Date; seed: number };

export type TrailerOption = { id: string; plates: string; body: string; adr: boolean; capacityPallets: number; where: string; sameYard: boolean; check: SwapCheck };
export type TrailerSituation = {
  vehicle: { id: string; plates: string; kind: string };
  current: { id: string; plates: string; body: string; since: string } | null;
  /** Where the tractor stands idle, by name (null: on the road or busy). */
  standsAt: string | null;
  inProgressOrder: string | null;
  drop: SwapCheck;
  options: TrailerOption[];
};

async function load(db: Executor, sandbox: Sandbox, vehicleId: string, simNow: Date) {
  await ensureFleetFile(db, sandbox);
  const sid = sandbox.id;
  const [[vehicle], [state], allTrailers, open, pointRows, vehicleOrders, terms] = await Promise.all([
    db.select().from(vehicles).where(and(eq(vehicles.sandboxId, sid), eq(vehicles.id, vehicleId))),
    db.select().from(vehicleStates).where(and(eq(vehicleStates.sandboxId, sid), eq(vehicleStates.vehicleId, vehicleId))),
    db.select().from(trailers).where(eq(trailers.sandboxId, sid)),
    db.select().from(couplings).where(and(eq(couplings.sandboxId, sid), isNull(couplings.toSim))),
    db.select({ id: points.id, name: points.name }).from(points).where(eq(points.sandboxId, sid)),
    db.select().from(orders).where(and(eq(orders.sandboxId, sid), eq(orders.vehicleId, vehicleId), inArray(orders.status, [...IN_PROGRESS, ...ASSIGNED]))),
    db.select().from(fleetTerms).where(and(eq(fleetTerms.sandboxId, sid), eq(fleetTerms.subjectType, "trailer"), eq(fleetTerms.blocking, true))),
  ]);
  if (!vehicle) throw new HttpError(404, "Nie ma takiego pojazdu.");
  const pointName = (id: string) => pointRows.find((p) => p.id === id)?.name ?? id;
  const currentCoupling = open.find((c) => c.vehicleId === vehicleId) ?? null;
  const coupledTrailerIds = new Set(open.map((c) => c.trailerId));
  const asSwap = (t: typeof trailers.$inferSelect): SwapTrailer => ({
    id: t.id,
    plates: t.plates,
    body: t.body,
    capacityPallets: t.capacityPallets,
    capacityKg: t.capacityKg,
    adr: t.adr,
    // A trailer under a tractor is not parked, whatever the column says.
    parkedAtPointId: coupledTrailerIds.has(t.id) ? null : t.parkedAtPointId,
    overdueBlocking: terms.filter((x) => x.subjectId === t.id && termStatus(x, simNow, null) === "po_terminie").map((x) => TERM_LABEL[x.kind]),
  });
  const idle = state && state.mode === "idle" && state.pointId ? state.pointId : null;
  const input: SwapInput = {
    vehicle: { kind: vehicle.kind, plates: vehicle.plates, adr: vehicle.adr },
    idleAtPointId: idle,
    inProgressOrder: vehicleOrders.find((o) => IN_PROGRESS.includes(o.status))?.number ?? null,
    assigned: vehicleOrders.filter((o) => ASSIGNED.includes(o.status)).map((o) => ({ number: o.number, cargoPallets: o.cargoPallets, cargoKg: o.cargoKg, bodyRequired: o.bodyRequired, adrRequired: o.adrRequired })),
    pointName,
  };
  const current = currentCoupling ? allTrailers.find((t) => t.id === currentCoupling.trailerId) ?? null : null;
  return { vehicle, input, idle, currentCoupling, current, allTrailers, asSwap, pointName, vehicleOrders };
}

/** What the forwarder sees in "Przepnij naczepę": the current trailer, the free ones and what each change would mean. */
export async function trailerSituation(db: Executor, sandbox: Sandbox, vehicleId: string, simNow: Date): Promise<TrailerSituation> {
  const l = await load(db, sandbox, vehicleId, simNow);
  const options = l.allTrailers
    .map(l.asSwap)
    .filter((t) => t.parkedAtPointId !== null)
    .map((t) => {
      const row = l.allTrailers.find((x) => x.id === t.id)!;
      return {
        id: t.id,
        plates: t.plates,
        body: row.body,
        adr: t.adr,
        capacityPallets: t.capacityPallets,
        where: l.pointName(t.parkedAtPointId!),
        sameYard: t.parkedAtPointId === l.idle,
        check: checkHook(l.input, t),
      };
    })
    .sort((a, b) => Number(b.sameYard) - Number(a.sameYard) || a.plates.localeCompare(b.plates));
  return {
    vehicle: { id: l.vehicle.id, plates: l.vehicle.plates, kind: l.vehicle.kind },
    current: l.current && l.currentCoupling ? { id: l.current.id, plates: l.current.plates, body: l.current.body, since: l.currentCoupling.fromSim.toISOString() } : null,
    standsAt: l.idle ? l.pointName(l.idle) : null,
    inProgressOrder: l.input.inProgressOrder,
    drop: checkDrop(l.input, l.current ? l.asSwap(l.current) : null),
    options,
  };
}

/**
 * Records a swap that happened in the yard: the old trailer stays where the tractor stands,
 * the new one goes under it, and orders assigned but not started follow the new trailer.
 * `trailerId: null` drops the current trailer. Warnings need `confirm`.
 * Run it in a transaction (see swapTrailerSafely): the steps must happen together.
 */
export async function swapTrailer(db: Executor, sandbox: Sandbox, vehicleId: string, trailerId: string | null, opts: { confirm: boolean }, simNow: Date) {
  const l = await load(db, sandbox, vehicleId, simNow);
  const next = trailerId ? l.allTrailers.find((t) => t.id === trailerId) : null;
  if (trailerId && !next) throw new HttpError(404, "Nie ma takiej naczepy.");
  if (next && next.id === l.current?.id) throw new HttpError(409, `Naczepa ${next.plates} już jest pod tym ciągnikiem.`);
  const check = next ? checkHook(l.input, l.asSwap(next)) : checkDrop(l.input, l.current ? l.asSwap(l.current) : null);
  if (check.blockers.length) throw new HttpError(409, check.blockers[0]);
  if (check.warnings.length && !opts.confirm) throw new HttpError(409, `Potwierdź przepięcie: ${check.warnings.join(" ")}`);
  const sid = sandbox.id;
  const yard = l.idle!;
  if (l.currentCoupling) {
    await db.update(couplings).set({ toSim: simNow }).where(and(eq(couplings.sandboxId, sid), eq(couplings.id, l.currentCoupling.id)));
    await db.update(trailers).set({ parkedAtPointId: yard }).where(and(eq(trailers.sandboxId, sid), eq(trailers.id, l.currentCoupling.trailerId)));
  }
  if (next) {
    // A random id: with the clock paused, a swap back and forth happens at one and the same sim time.
    await db.insert(couplings).values({ sandboxId: sid, id: `cp-${randomUUID()}`, vehicleId, trailerId: next.id, fromSim: simNow, toSim: null });
    await db.update(trailers).set({ parkedAtPointId: null }).where(and(eq(trailers.sandboxId, sid), eq(trailers.id, next.id)));
  }
  const waiting = l.vehicleOrders.filter((o) => ASSIGNED.includes(o.status)).map((o) => o.id);
  if (waiting.length) await db.update(orders).set({ trailerId: next?.id ?? null }).where(and(eq(orders.sandboxId, sid), inArray(orders.id, waiting)));
  return { warnings: check.warnings };
}

/** The swap as one transaction; two clicks at once end in a clear message, not two trailers under one tractor. */
export async function swapTrailerSafely(db: Db, sandbox: Sandbox, vehicleId: string, trailerId: string | null, opts: { confirm: boolean }, simNow: Date) {
  try {
    return await db.transaction((tx) => swapTrailer(tx, sandbox, vehicleId, trailerId, opts, simNow));
  } catch (error) {
    if (uniqueViolation(error) !== null) throw new HttpError(409, "Ktoś właśnie przepiął tę naczepę albo ten ciągnik — odśwież i spróbuj ponownie.");
    throw error;
  }
}

export type CouplingEntry = { vehiclePlates: string; trailerPlates: string; from: string; to: string | null };

/** Which trailer was under which tractor and when, newest first, per trailer and per tractor. */
export async function couplingHistory(db: Executor, sandboxId: string) {
  const [rows, vs, ts] = await Promise.all([
    db.select().from(couplings).where(eq(couplings.sandboxId, sandboxId)).orderBy(desc(couplings.fromSim)),
    db.select({ id: vehicles.id, plates: vehicles.plates }).from(vehicles).where(eq(vehicles.sandboxId, sandboxId)),
    db.select({ id: trailers.id, plates: trailers.plates }).from(trailers).where(eq(trailers.sandboxId, sandboxId)),
  ]);
  const entry = (c: (typeof rows)[number]): CouplingEntry => ({
    vehiclePlates: vs.find((v) => v.id === c.vehicleId)?.plates ?? c.vehicleId,
    trailerPlates: ts.find((t) => t.id === c.trailerId)?.plates ?? c.trailerId,
    from: c.fromSim.toISOString(),
    to: c.toSim?.toISOString() ?? null,
  });
  const by = (key: "vehicleId" | "trailerId") => {
    const map = new Map<string, CouplingEntry[]>();
    for (const c of rows) map.set(c[key], [...(map.get(c[key]) ?? []), entry(c)]);
    return map;
  };
  return { byVehicle: by("vehicleId"), byTrailer: by("trailerId") };
}
