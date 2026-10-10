import type { OrderStatus, StatusActor } from "@/db/schema";

type Rule = { from: OrderStatus[]; to: OrderStatus; actors: StatusActor[] };

/** Every allowed status change and who may make it (spec §8). */
export const TRANSITIONS: Rule[] = [
  { from: ["SZKIC"], to: "NOWE", actors: ["dispatcher"] },
  { from: ["SZKIC"], to: "ANULOWANE", actors: ["dispatcher"] },
  { from: ["NOWE"], to: "PRZYPISANE", actors: ["dispatcher", "system"] },
  { from: ["PRZYPISANE"], to: "WYSLANE", actors: ["system"] },
  { from: ["PRZYPISANE", "WYSLANE"], to: "NOWE", actors: ["dispatcher", "system"] },
  { from: ["WYSLANE"], to: "POTWIERDZONE", actors: ["ai", "dispatcher"] },
  { from: ["POTWIERDZONE"], to: "ZALADUNEK", actors: ["system"] },
  { from: ["ZALADUNEK"], to: "W_DRODZE", actors: ["system"] },
  { from: ["W_DRODZE"], to: "ROZLADUNEK", actors: ["system"] },
  { from: ["ROZLADUNEK"], to: "DO_ZAMKNIECIA", actors: ["ai", "dispatcher"] },
  { from: ["DO_ZAMKNIECIA"], to: "ZAMKNIETE", actors: ["dispatcher"] },
  { from: ["DO_ZAMKNIECIA"], to: "ROZLADUNEK", actors: ["dispatcher"] },
  { from: ["NOWE", "PRZYPISANE", "WYSLANE", "POTWIERDZONE"], to: "ANULOWANE", actors: ["dispatcher"] },
];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  SZKIC: "Szkic",
  NOWE: "Nowe",
  PRZYPISANE: "Przypisane",
  WYSLANE: "Wysłane do kierowcy",
  POTWIERDZONE: "W realizacji",
  ZALADUNEK: "Załadunek",
  W_DRODZE: "W drodze",
  ROZLADUNEK: "Rozładunek",
  DO_ZAMKNIECIA: "Do zamknięcia",
  ZAMKNIETE: "Zamknięte",
  ANULOWANE: "Anulowane",
};

/** Orders that move on the map and are watched for risk. */
export const MOVING_STATUSES: OrderStatus[] = ["POTWIERDZONE", "ZALADUNEK", "W_DRODZE"];

export class TransitionError extends Error {}

export function canTransition(from: OrderStatus, to: OrderStatus, actor: StatusActor): boolean {
  return TRANSITIONS.some((r) => r.to === to && r.from.includes(from) && r.actors.includes(actor));
}

export function transitionError(from: OrderStatus, to: OrderStatus, actor: StatusActor): string | null {
  if (canTransition(from, to, actor)) return null;
  const exists = TRANSITIONS.some((r) => r.to === to && r.from.includes(from));
  if (!exists) {
    if (to === "ANULOWANE") return "Zlecenia po załadunku nie można anulować.";
    return `Nie można zmienić statusu z „${STATUS_LABEL[from]}” na „${STATUS_LABEL[to]}”.`;
  }
  return `Tej zmiany statusu nie może wykonać ${ACTOR_LABEL[actor]}.`;
}

export const ACTOR_LABEL: Record<StatusActor, string> = {
  dispatcher: "spedytor",
  driver: "kierowca",
  ai: "AI",
  system: "system",
};
