import type { TermKind } from "@/db/schema";
import { RENEW_MONTHS, TERM_LABEL } from "./fleet-terms";

/**
 * "Document → fleet file": what the AI read from a service document becomes a *proposal* for one
 * deadline. The reading only transcribes; matching the vehicle and computing the next deadline is
 * done here, deterministically, and a person approves the result.
 */

/** Kinds a vehicle or trailer document can renew (driver documents are out of scope here). */
export const SERVICE_KINDS = ["przeglad", "oc", "tachograf", "serwis", "atp"] as const satisfies readonly TermKind[];
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export type ServiceReadingInput = {
  legible: boolean;
  docKind: ServiceKind | "inne" | null;
  plates: string | null;
  performedOn: string | null;
  validUntil: string | null;
  odometerKm: number | null;
  docNumber: string | null;
  issuer: string | null;
};

export type ServiceSubject = {
  id: string;
  type: "vehicle" | "trailer";
  plates: string;
  odometerKm: number | null;
  serviceIntervalKm: number;
  terms: { id: string; kind: TermKind; dueSim: Date | null; dueKm: number | null }[];
};

export type ServiceProposal = {
  subjectId: string | null;
  termId: string | null;
  kind: ServiceKind | null;
  performedOn: string | null;
  /** Date terms: the new deadline (yyyy-mm-dd). */
  validUntil: string | null;
  /** Where `validUntil` comes from: printed on the document, or computed from the date of the work. */
  validUntilSource: "dokument" | "regula" | null;
  /** Service by mileage: the odometer reading of the next service. */
  nextKm: number | null;
  docNumber: string;
  issuer: string;
  warnings: string[];
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day in yyyy-mm-dd, or null (the model's output is checked like any other input). */
export function parseDay(value: string | null | undefined): Date | null {
  const m = value ? ISO_DAY.exec(value.trim()) : null;
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCFullYear() === Number(m[1]) && date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]) ? date : null;
}

const toDay = (date: Date) => date.toISOString().slice(0, 10);

/** "el 9k-41" and "EL9K41" are the same plate. */
export function normalizePlates(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function addMonths(day: string, months: number): string | null {
  const date = parseDay(day);
  if (!date) return null;
  date.setUTCMonth(date.getUTCMonth() + months);
  return toDay(date);
}

export function proposeServiceEntry(reading: ServiceReadingInput | null, subjects: ServiceSubject[], today: Date): ServiceProposal {
  const empty: ServiceProposal = { subjectId: null, termId: null, kind: null, performedOn: null, validUntil: null, validUntilSource: null, nextKm: null, docNumber: "", issuer: "", warnings: [] };
  if (!reading) return empty;
  const warnings: string[] = [];
  if (!reading.legible) warnings.push("AI uznało dokument za mało czytelny. Sprawdź każde pole z dokumentem.");

  const kind = reading.docKind && reading.docKind !== "inne" ? reading.docKind : null;
  if (!kind) warnings.push("Nie udało się rozpoznać rodzaju dokumentu. Wybierz rodzaj terminu ręcznie.");

  const wanted = reading.plates ? normalizePlates(reading.plates) : "";
  const subject = wanted ? (subjects.find((s) => normalizePlates(s.plates) === wanted) ?? null) : null;
  if (!wanted) warnings.push("Na dokumencie nie odczytano numeru rejestracyjnego. Wybierz pojazd ręcznie.");
  else if (!subject) warnings.push(`W kartotece nie ma pojazdu ani naczepy o numerze ${reading.plates}. Wybierz pojazd ręcznie albo sprawdź, czy to dokument tej firmy.`);

  const term = subject && kind ? (subject.terms.find((t) => t.kind === kind) ?? null) : null;
  if (subject && kind && !term) warnings.push(`${subject.plates} nie ma w kartotece terminu „${TERM_LABEL[kind]}”.`);

  const performed = parseDay(reading.performedOn);
  if (reading.performedOn && !performed) warnings.push("Data wykonania na dokumencie jest nieczytelna lub niepoprawna.");
  if (performed && performed.getTime() > today.getTime() + 86_400_000) warnings.push("Data wykonania jest w przyszłości. Sprawdź dokument.");
  const performedOn = performed ? toDay(performed) : null;

  let validUntil: string | null = null;
  let validUntilSource: ServiceProposal["validUntilSource"] = null;
  let nextKm: number | null = null;

  if (kind === "serwis") {
    // Mileage-based: the document states the odometer, the next service follows from the interval.
    const base = reading.odometerKm ?? subject?.odometerKm ?? null;
    if (reading.odometerKm === null && subject) warnings.push("Dokument nie podaje przebiegu. Przyjęto obecny stan licznika z kartoteki.");
    if (base !== null && subject) nextKm = Math.round(base) + subject.serviceIntervalKm;
    if (reading.odometerKm !== null && subject?.odometerKm != null && reading.odometerKm > subject.odometerKm + 2_000) {
      warnings.push("Przebieg na dokumencie jest wyższy niż stan licznika w kartotece. Sprawdź, czy to właściwy pojazd.");
    }
  } else if (kind) {
    const printed = parseDay(reading.validUntil);
    if (reading.validUntil && !printed) warnings.push("Data ważności na dokumencie jest nieczytelna lub niepoprawna.");
    if (printed) {
      validUntil = toDay(printed);
      validUntilSource = "dokument";
    } else if (performedOn) {
      validUntil = addMonths(performedOn, RENEW_MONTHS[kind] ?? 12);
      validUntilSource = "regula";
    }
    const until = parseDay(validUntil);
    if (until && until.getTime() < today.getTime()) warnings.push("Według dokumentu termin już minął. To może być stary dokument.");
    if (until && performed && until.getTime() <= performed.getTime()) warnings.push("Data ważności nie jest późniejsza niż data wykonania.");
    if (until && term?.dueSim && until.getTime() <= term.dueSim.getTime()) warnings.push("Termin w kartotece jest taki sam albo późniejszy. To może być dokument już wprowadzony.");
  }

  return { subjectId: subject?.id ?? null, termId: term?.id ?? null, kind, performedOn, validUntil, validUntilSource, nextKm, docNumber: (reading.docNumber ?? "").slice(0, 60), issuer: (reading.issuer ?? "").slice(0, 120), warnings };
}
