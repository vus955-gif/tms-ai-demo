import type { AbsenceKind, TermKind } from "@/db/schema";

/**
 * Fleet file and driver calendar of the demo (stage 6). Most deadlines are far
 * away; a few are set to show the states (soon, overdue, blocking). Offsets are
 * days from the start of the demo day. All data is fictional.
 */

export type TermOverride = { subjectId: string; kind: TermKind; days?: number; kmLeft?: number };

export const TERM_OVERRIDES: TermOverride[] = [
  { subjectId: "v-el9k41", kind: "tachograf", days: -1 }, // overdue and blocking: EL 9K41 drops out of "klocki"
  { subjectId: "v-po2c19", kind: "oc", days: 9 },
  { subjectId: "v-wb6p77", kind: "serwis", kmLeft: 1800 },
  { subjectId: "v-el5r30", kind: "serwis", kmLeft: -1200 },
  { subjectId: "tr-gd15pl", kind: "atp", days: 6 }, // the only reefer under a tractor at the start (EL 40CZ waits in Łódź): the weekly plan of standing orders hits it at the end of next week
  { subjectId: "d-krawczyk", kind: "karta_kierowcy", days: 20 },
  { subjectId: "d-mazur", kind: "badania", days: 12 },
];

export type ScenarioAbsence = { driverId: string; kind: AbsenceKind; fromDay: number; days: number; note: string };

export const ABSENCES: ScenarioAbsence[] = [
  { driverId: "d-kaminska", kind: "urlop", fromDay: 1, days: 2, note: "urlop wypoczynkowy" },
  { driverId: "d-wisniewska", kind: "szkolenie", fromDay: 2, days: 1, note: "szkolenie okresowe kod 95" },
];

/** Service interval by vehicle kind (km), simplified. */
export const SERVICE_INTERVAL_KM: Record<"bus" | "solo" | "tractor", number> = { bus: 30_000, solo: 60_000, tractor: 100_000 };
