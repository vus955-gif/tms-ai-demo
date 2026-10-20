/**
 * Swapping a trailer under a tractor (or dropping it). Pure rules: what stops a swap
 * outright, and what the forwarder should see before confirming it.
 *
 * Demo model: a swap is recorded when it happens in the yard, so the tractor must stand
 * empty at the point where the trailer is parked (a base or a client's yard).
 */

export type SwapBody = "plandeka" | "chlodnia" | "skrzynia" | null;

export type SwapTrailer = {
  id: string;
  plates: string;
  body: SwapBody;
  capacityPallets: number;
  capacityKg: number;
  adr: boolean;
  /** Where it stands; null when it is under a tractor. */
  parkedAtPointId: string | null;
  /** Overdue terms that block assignment (e.g. technical inspection). */
  overdueBlocking: string[];
};

export type SwapOrder = { number: string; cargoPallets: number; cargoKg: number; bodyRequired: SwapBody; adrRequired: boolean };

export type SwapInput = {
  /** `adr`: the tractor's own ADR kit counts too (matching takes tractor or trailer). */
  vehicle: { kind: "bus" | "solo" | "tractor"; plates: string; adr?: boolean };
  /** Where the tractor stands idle, if it does. */
  idleAtPointId: string | null;
  /** An order loaded or being (un)loaded right now: its cargo is in the trailer. */
  inProgressOrder: string | null;
  /** Orders assigned to this tractor that have not started yet. */
  assigned: SwapOrder[];
  pointName: (id: string) => string;
};

export type SwapCheck = { blockers: string[]; warnings: string[] };

const BODY_LABEL: Record<Exclude<SwapBody, null>, string> = { plandeka: "plandeka", chlodnia: "chłodnia", skrzynia: "skrzynia" };

function common(input: SwapInput): string[] {
  if (input.vehicle.kind !== "tractor") return [`${input.vehicle.plates} to nie ciągnik — nie ma naczepy.`];
  if (input.inProgressOrder) return [`Ciągnik wiezie ładunek zlecenia ${input.inProgressOrder} — przepnij po rozładunku.`];
  if (!input.idleAtPointId) return ["Ciągnik jest w trasie — naczepę przepina się na postoju (w bazie albo u klienta)."];
  return [];
}

/** Hooking `next` under the tractor (its current trailer, if any, stays where the tractor stands). */
export function checkHook(input: SwapInput, next: SwapTrailer): SwapCheck {
  const blockers = common(input);
  if (next.parkedAtPointId === null) blockers.push(`Naczepa ${next.plates} jest pod innym ciągnikiem.`);
  else if (input.idleAtPointId && next.parkedAtPointId !== input.idleAtPointId) {
    blockers.push(`Naczepa ${next.plates} stoi w: ${input.pointName(next.parkedAtPointId)}, a ciągnik w: ${input.pointName(input.idleAtPointId)}. Przepnij, gdy kierowca tam dojedzie.`);
  }
  const warnings: string[] = [];
  for (const o of input.assigned) {
    if (o.bodyRequired === "chlodnia" && next.body !== "chlodnia") warnings.push(`${o.number} wymaga chłodni — ${next.plates} to ${next.body ? BODY_LABEL[next.body] : "naczepa bez zabudowy"}.`);
    if (o.adrRequired && !next.adr && !input.vehicle.adr) warnings.push(`${o.number} to ładunek ADR — ani ${input.vehicle.plates}, ani ${next.plates} nie ma wyposażenia ADR.`);
    if (o.cargoPallets > next.capacityPallets) warnings.push(`${o.number}: ${o.cargoPallets} palet, a ${next.plates} mieści ${next.capacityPallets}.`);
    else if (o.cargoKg > next.capacityKg) warnings.push(`${o.number}: ${(o.cargoKg / 1000).toFixed(1).replace(".", ",")} t, a ładowność ${next.plates} to ${(next.capacityKg / 1000).toFixed(1).replace(".", ",")} t.`);
  }
  for (const term of next.overdueBlocking) warnings.push(`${next.plates}: ${term} po terminie — z tą naczepą ciągnik nie dostanie nowych zleceń.`);
  return { blockers, warnings };
}

/** Dropping the current trailer where the tractor stands (it then runs solo). */
export function checkDrop(input: SwapInput, current: SwapTrailer | null): SwapCheck {
  const blockers = common(input);
  if (!current) blockers.push("Ciągnik nie ma naczepy.");
  const warnings = input.assigned.map((o) => `${o.number} jest przydzielone temu ciągnikowi — bez naczepy go nie wykona.`);
  return { blockers, warnings };
}
