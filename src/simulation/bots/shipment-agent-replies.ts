import { formatShipmentDate } from "@/domain/shipment-texts";
import type { MilestoneKind, ShipmentMode } from "@/domain/shipments";

/**
 * Demo agents answering a status request. They know the shipment's hidden "truth"
 * (real delays) and report what has happened by now, the way people write such
 * mails — the forwarder's system learns it only by reading the reply.
 */
export type Truth = { departureDelayH: number; middleDelayH: number; arrivalDelayH: number; reason: string; reasonEn?: string };

const H = 3_600_000;

/** Real times of the milestones: departure late by X, the middle stop later still, arrival as well. */
export function trueTimes(planned: { kind: MilestoneKind; plannedMs: number }[], truth: Truth): Map<MilestoneKind, number> {
  const out = new Map<MilestoneKind, number>();
  const dep = truth.departureDelayH * H;
  const mid = dep + truth.middleDelayH * H;
  const arr = mid + truth.arrivalDelayH * H;
  for (const m of planned) {
    const shift = m.kind === "booking" || m.kind === "terminal_in" ? 0 : m.kind === "departed" ? dep : m.kind === "transshipment" || m.kind === "border" ? mid : arr;
    out.set(m.kind, m.plannedMs + shift);
  }
  return out;
}

/** Terse, the way agents write status mails: "wypłynięcie (Szanghaj): 21.09.2026 08:00". */
const PL: Record<Exclude<MilestoneKind, "booking">, Record<ShipmentMode, string>> = {
  terminal_in: { sea: "kontener przyjęty w terminalu", air: "towar przyjęty w terminalu cargo", rail: "kontener przyjęty w terminalu" },
  departed: { sea: "wypłynięcie", air: "odlot", rail: "odjazd pociągu" },
  transshipment: { sea: "przeładunek", air: "przeładunek", rail: "przeładunek" },
  border: { sea: "przejście graniczne", air: "przejście graniczne", rail: "przejście graniczne" },
  arrived: { sea: "przybycie statku", air: "przylot", rail: "przyjazd pociągu" },
  customs: { sea: "odprawa celna zakończona", air: "odprawa celna zakończona", rail: "odprawa celna zakończona" },
  delivered: { sea: "dostarczono", air: "dostarczono", rail: "dostarczono" },
};
const EN: Record<Exclude<MilestoneKind, "booking">, string> = {
  terminal_in: "received at terminal",
  departed: "departed",
  transshipment: "transshipment",
  border: "border crossing",
  arrived: "arrived",
  customs: "customs cleared",
  delivered: "delivered",
};

export function agentStatusReplyText(input: {
  language: "pl" | "en";
  mode: ShipmentMode;
  number: string;
  contactName: string;
  milestones: { kind: MilestoneKind; location: string; plannedMs: number }[];
  truth: Truth;
  nowMs: number;
}): string {
  const real = trueTimes(input.milestones, input.truth);
  // Every event so far (a reader that misses one would otherwise keep asking about it).
  const happened = input.milestones.filter((m) => m.kind !== "booking" && (real.get(m.kind) ?? Infinity) <= input.nowMs);
  const arrival = input.milestones.find((m) => m.kind === "arrived");
  const arrivedMs = arrival ? real.get("arrived")! : null;
  const totalDelayH = input.truth.departureDelayH + input.truth.middleDelayH + input.truth.arrivalDelayH;
  const lines = happened.map((m) => {
    const date = formatShipmentDate(real.get(m.kind)!);
    const kind = m.kind as Exclude<MilestoneKind, "booking">;
    const where = kind === "customs" || kind === "delivered" ? "" : ` (${m.location})`;
    return `- ${input.language === "en" ? EN[kind] : PL[kind][input.mode]}${where}: ${date}`;
  });
  const notArrived = arrivedMs !== null && arrivedMs > input.nowMs && arrival;
  if (input.language === "en") {
    return [
      `Hello,`,
      ``,
      `status of ${input.number}:`,
      ...(lines.length ? lines : ["- booking confirmed, waiting for departure"]),
      notArrived ? `ETA ${arrival.location}: ${formatShipmentDate(arrivedMs)}` : "",
      totalDelayH >= 12 && happened.length > 0 ? `Delay approx. ${totalDelayH} h — ${input.truth.reasonEn ?? input.truth.reason}.` : "",
      ``,
      `Best regards`,
      input.contactName,
    ]
      .filter((l, i, all) => l !== "" || all[i - 1] !== "")
      .join("\n");
  }
  return [
    `Dzień dobry,`,
    ``,
    `status ${input.number}:`,
    ...(lines.length ? lines : ["- booking potwierdzony, czekamy na wyjazd"]),
    notArrived ? `ETA ${arrival.location}: ${formatShipmentDate(arrivedMs)}` : "",
    totalDelayH >= 12 && happened.length > 0 ? `Opóźnienie ok. ${totalDelayH} h — ${input.truth.reason}.` : "",
    ``,
    `Pozdrawiam`,
    input.contactName,
  ]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n");
}
