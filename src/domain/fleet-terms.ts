import type { AbsenceKind, TermKind } from "@/db/schema";

/**
 * Fleet file rules (stage 6): when a deadline is "soon" or overdue, which ones
 * block new orders, and what the next deadline is after renewal. Intervals are
 * simplified for the demo — real ones depend on vehicle type and law.
 */

export const TERM_LABEL: Record<TermKind, string> = {
  przeglad: "badanie techniczne",
  oc: "ubezpieczenie OC",
  tachograf: "legalizacja tachografu",
  serwis: "serwis okresowy",
  atp: "świadectwo ATP (chłodnia)",
  prawo_jazdy: "prawo jazdy",
  kwalifikacja: "kwalifikacja (kod 95)",
  karta_kierowcy: "karta kierowcy",
  badania: "badania lekarskie i psychotesty",
  adr: "zaświadczenie ADR",
};

export const ABSENCE_LABEL: Record<AbsenceKind, string> = { urlop: "urlop", l4: "zwolnienie lekarskie", szkolenie: "szkolenie", badania: "badania", wolne: "dzień wolny" };

/** Months until the next deadline after renewal (simplified for the demo). */
export const RENEW_MONTHS: Partial<Record<TermKind, number>> = {
  przeglad: 12,
  oc: 12,
  tachograf: 24,
  atp: 36,
  prawo_jazdy: 180,
  kwalifikacja: 60,
  karta_kierowcy: 60,
  badania: 60,
  adr: 60,
};

export const SOON_DAYS = 30;
export const SOON_KM = 5000;

export type TermStatus = "ok" | "wkrotce" | "po_terminie";

export type Term = { kind: TermKind; dueSim: Date | null; dueKm: number | null; blocking: boolean };

export function termStatus(t: Pick<Term, "dueSim" | "dueKm">, now: Date, odometerKm: number | null): TermStatus {
  const dayMs = 86_400_000;
  if (t.dueSim) {
    if (t.dueSim < now) return "po_terminie";
    if (t.dueSim.getTime() - now.getTime() <= SOON_DAYS * dayMs) return "wkrotce";
  }
  if (t.dueKm !== null && odometerKm !== null) {
    if (odometerKm >= t.dueKm) return "po_terminie";
    if (t.dueKm - odometerKm <= SOON_KM) return "wkrotce";
  }
  return "ok";
}

/** Next deadline after the work was done at `doneAt` (km terms: `serviceIntervalKm` more). */
export function renewTerm(t: Term, doneAt: Date, odometerKm: number, serviceIntervalKm: number): Pick<Term, "dueSim" | "dueKm"> {
  if (t.kind === "serwis") return { dueSim: null, dueKm: odometerKm + serviceIntervalKm };
  const months = RENEW_MONTHS[t.kind] ?? 12;
  const next = new Date(doneAt);
  next.setUTCMonth(next.getUTCMonth() + months);
  return { dueSim: next, dueKm: null };
}

/** Reasons a vehicle/driver cannot take an order starting at `from`: blocking terms that lapse by then. */
export function blockingReasons(terms: Term[], from: Date, fmt: (d: Date) => string): string[] {
  return terms.filter((t) => t.blocking && t.dueSim && t.dueSim < from).map((t) => `${TERM_LABEL[t.kind]} ważne tylko do ${fmt(t.dueSim!)}`);
}

/** Absences overlapping the order's time span. */
export function absenceReasons(absences: { kind: AbsenceKind; fromSim: Date; toSim: Date }[], from: Date, to: Date, fmt: (d: Date) => string): string[] {
  return absences.filter((a) => a.fromSim < to && a.toSim > from).map((a) => `${ABSENCE_LABEL[a.kind]} ${fmt(a.fromSim)}–${fmt(new Date(a.toSim.getTime() - 1))}`);
}
