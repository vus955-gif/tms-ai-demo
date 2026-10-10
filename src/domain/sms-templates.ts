import { formatSimClock, formatTime } from "@/lib/format";

/**
 * SMS texts sent to drivers. Built from order data only — addresses, times and
 * references are copied verbatim; AI never writes these (spec §2, §7).
 */

type PointInfo = { name: string; address: string; city: string; country: string; requirements: string; notes: string };
type OrderInfo = {
  number: string;
  pickupFrom: Date;
  pickupTo: Date;
  deliveryFrom: Date;
  deliveryTo: Date;
  cargoPallets: number;
  cargoKg: number;
  bodyRequired: string | null;
  adrRequired: boolean;
  references: string[];
  notes: string;
};

/** "śr 15.10 07:00–09:00" (or both dates when the window spans midnight). */
export function windowText(from: Date, to: Date): string {
  const sameDay = formatSimClock(from).slice(0, -8) === formatSimClock(to).slice(0, -8);
  return sameDay ? `${formatSimClock(from).replace(" · ", " ")}–${formatTime(to)}` : `${formatSimClock(from).replace(" · ", " ")} – ${formatSimClock(to).replace(" · ", " ")}`;
}

function pointLines(p: PointInfo): string[] {
  const lines = [`${p.name}, ${p.address}, ${p.city} (${p.country})`];
  const remarks = [p.requirements, p.notes].filter(Boolean).join(". ");
  if (remarks) lines.push(`Uwagi: ${remarks}`);
  return lines;
}

export function orderSms(order: OrderInfo, clientName: string, pickup: PointInfo, delivery: PointInfo): string {
  const cargo = [`${order.cargoPallets} palet`, `${order.cargoKg} kg`];
  if (order.bodyRequired === "chlodnia") cargo.push("chłodnia");
  if (order.adrRequired) cargo.push("ADR");
  return [
    `ZLECENIE ${order.number} · ${clientName}`,
    `ZAŁADUNEK: ${windowText(order.pickupFrom, order.pickupTo)}`,
    ...pointLines(pickup),
    `ROZŁADUNEK: ${windowText(order.deliveryFrom, order.deliveryTo)}`,
    ...pointLines(delivery),
    `Ładunek: ${cargo.join(", ")}`,
    ...(order.references.length ? [`Ref: ${order.references.join(", ")}`] : []),
    ...(order.notes ? [`Uwagi do zlecenia: ${order.notes}`] : []),
    "Potwierdź odpisując OK.",
  ].join("\n");
}

export function reminderSms(order: Pick<OrderInfo, "number" | "pickupFrom">): string {
  return `Przypomnienie: potwierdź zlecenie ${order.number} (załadunek ${formatSimClock(order.pickupFrom).replace(" · ", " ")}). Odpisz OK albo zadzwoń do spedycji.`;
}

export function cancellationSms(order: Pick<OrderInfo, "number">): string {
  return `Zlecenie ${order.number} zostało odwołane. Nie jedź na załadunek. W razie pytań zadzwoń do spedycji.`;
}
