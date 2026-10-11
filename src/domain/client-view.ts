import type { OrderStatus } from "@/db/schema";

/**
 * What a client may see about their transport (spec §7.8): order number,
 * plates, a client-facing status, ETA and route progress. Never the driver's
 * name or phone — client e-mails and the client panel are built only from this.
 */
export type ClientView = {
  number: string;
  plates: string | null;
  trailerPlates: string | null;
  status: string;
  eta: string | null;
  pickupWindow: { from: string; to: string };
  pickupCity: string;
  deliveryWindow: { from: string; to: string };
  progressPct: number | null;
  references: string[];
  deliveryCity: string;
  /** Live tracking link for the client, when the dispatcher shared one (stage 5). */
  trackingUrl?: string | null;
};

export const CLIENT_STATUS: Record<OrderStatus, string> = {
  SZKIC: "przyjęte do realizacji",
  NOWE: "przyjęte do realizacji",
  PRZYPISANE: "przyjęte do realizacji",
  WYSLANE: "przyjęte do realizacji",
  POTWIERDZONE: "auto w drodze na załadunek",
  ZALADUNEK: "trwa załadunek",
  W_DRODZE: "w drodze do odbiorcy",
  ROZLADUNEK: "trwa rozładunek",
  DO_ZAMKNIECIA: "dostarczone",
  ZAMKNIETE: "dostarczone",
  ANULOWANE: "anulowane",
};

export function clientView(input: {
  number: string;
  status: OrderStatus;
  plates: string | null;
  trailerPlates: string | null;
  eta: Date | null;
  pickupFrom: Date;
  pickupTo: Date;
  pickupCity: string;
  deliveryFrom: Date;
  deliveryTo: Date;
  /** Fraction (0–1) of the leg to the consignee, when the truck is on it. */
  deliveryLegProgress: number | null;
  references: string[];
  deliveryCity: string;
}): ClientView {
  const assigned = !["SZKIC", "NOWE", "ANULOWANE"].includes(input.status);
  const delivered = ["ROZLADUNEK", "DO_ZAMKNIECIA", "ZAMKNIETE"].includes(input.status);
  const progressPct = delivered
    ? 100
    : input.status === "W_DRODZE" && input.deliveryLegProgress !== null
      ? Math.round(Math.min(Math.max(input.deliveryLegProgress, 0), 1) * 100)
      : ["POTWIERDZONE", "ZALADUNEK"].includes(input.status)
        ? 0
        : null;
  return {
    number: input.number,
    plates: assigned ? input.plates : null,
    trailerPlates: assigned ? input.trailerPlates : null,
    status: CLIENT_STATUS[input.status],
    eta: input.eta && ["POTWIERDZONE", "ZALADUNEK", "W_DRODZE"].includes(input.status) ? input.eta.toISOString() : null,
    pickupWindow: { from: input.pickupFrom.toISOString(), to: input.pickupTo.toISOString() },
    pickupCity: input.pickupCity,
    deliveryWindow: { from: input.deliveryFrom.toISOString(), to: input.deliveryTo.toISOString() },
    progressPct,
    references: input.references,
    deliveryCity: input.deliveryCity,
  };
}

const fold = (s: string) => s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Safety net for AI drafts to clients: true when the text names a driver
 * (surname, also declined) or contains a driver's phone number. Such a draft is replaced by a template.
 */
export function leaksDriverData(text: string, drivers: { firstName: string; lastName: string; phone: string }[]): boolean {
  const words = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
  const digits = text.replace(/\D/g, "");
  return drivers.some((d) => {
    const surname = fold(d.lastName);
    // Kowalski → Kowalskiego: declined forms share the stem; 5+ letters keeps false hits rare.
    const stem = surname.slice(0, Math.max(5, surname.length - 2));
    const named = words.some((w) => w === surname || (stem.length >= 5 && w.startsWith(stem)));
    const phone = d.phone.replace(/\D/g, "").slice(-9);
    return named || (phone.length === 9 && digits.includes(phone));
  });
}
