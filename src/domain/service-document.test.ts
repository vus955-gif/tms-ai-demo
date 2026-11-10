import { describe, expect, it } from "vitest";
import { addMonths, normalizePlates, parseDay, proposeServiceEntry, type ServiceReadingInput, type ServiceSubject } from "./service-document";

const today = new Date("2026-11-10T08:00:00Z");

const subjects: ServiceSubject[] = [
  {
    id: "v-el9k41",
    type: "vehicle",
    plates: "EL 9K41",
    odometerKm: 121_500,
    serviceIntervalKm: 100_000,
    terms: [
      { id: "v-el9k41:tachograf", kind: "tachograf", dueSim: new Date("2026-11-09T00:00:00Z"), dueKm: null },
      { id: "v-el9k41:przeglad", kind: "przeglad", dueSim: new Date("2027-03-01T00:00:00Z"), dueKm: null },
      { id: "v-el9k41:serwis", kind: "serwis", dueSim: null, dueKm: 140_000 },
    ],
  },
  { id: "tr-po48dl", type: "trailer", plates: "PO 48DL", odometerKm: null, serviceIntervalKm: 0, terms: [{ id: "tr-po48dl:przeglad", kind: "przeglad", dueSim: new Date("2027-01-10T00:00:00Z"), dueKm: null }] },
];

const reading = (over: Partial<ServiceReadingInput> = {}): ServiceReadingInput => ({
  legible: true,
  docKind: "tachograf",
  plates: "EL 9K41",
  performedOn: "2026-11-09",
  validUntil: "2028-11-09",
  odometerKm: 121_480,
  docNumber: "TS/2026/11/0457",
  issuer: "Tacho-Serwis Łódź Sp. z o.o.",
  ...over,
});

describe("service document → fleet file proposal", () => {
  it("matches the vehicle by plates however they are written and takes the deadline from the document", () => {
    const p = proposeServiceEntry(reading({ plates: "el9k-41" }), subjects, today);
    expect(p).toMatchObject({ subjectId: "v-el9k41", termId: "v-el9k41:tachograf", kind: "tachograf", performedOn: "2026-11-09", validUntil: "2028-11-09", validUntilSource: "dokument", nextKm: null, docNumber: "TS/2026/11/0457" });
    expect(p.warnings).toEqual([]);
  });

  it("computes the deadline from the renewal rule when the document does not print one, and says so", () => {
    const p = proposeServiceEntry(reading({ docKind: "przeglad", validUntil: null }), subjects, today);
    expect(p).toMatchObject({ termId: "v-el9k41:przeglad", validUntil: "2027-11-09", validUntilSource: "regula" });
  });

  it("derives the next service from the odometer on the document and the interval", () => {
    const p = proposeServiceEntry(reading({ docKind: "serwis", validUntil: null }), subjects, today);
    expect(p).toMatchObject({ termId: "v-el9k41:serwis", nextKm: 221_480, validUntil: null, validUntilSource: null });
    const noOdometer = proposeServiceEntry(reading({ docKind: "serwis", validUntil: null, odometerKm: null }), subjects, today);
    expect(noOdometer.nextKm).toBe(221_500);
    expect(noOdometer.warnings.join(" ")).toContain("nie podaje przebiegu");
  });

  it("does not invent a match: unknown plates, unknown kind and missing terms become warnings", () => {
    const foreign = proposeServiceEntry(reading({ plates: "WA 12345" }), subjects, today);
    expect(foreign).toMatchObject({ subjectId: null, termId: null });
    expect(foreign.warnings.join(" ")).toContain("nie ma pojazdu ani naczepy o numerze WA 12345");

    const other = proposeServiceEntry(reading({ docKind: "inne" }), subjects, today);
    expect(other).toMatchObject({ subjectId: "v-el9k41", kind: null, termId: null });

    const trailer = proposeServiceEntry(reading({ plates: "PO 48DL", docKind: "atp" }), subjects, today);
    expect(trailer.termId).toBeNull();
    expect(trailer.warnings.join(" ")).toContain("nie ma w kartotece terminu");
  });

  it("flags documents that look old, already entered, future-dated or inconsistent", () => {
    expect(proposeServiceEntry(reading({ validUntil: "2026-05-01", performedOn: "2024-05-01" }), subjects, today).warnings.join(" ")).toContain("termin już minął");
    expect(proposeServiceEntry(reading({ docKind: "przeglad", validUntil: "2027-03-01" }), subjects, today).warnings.join(" ")).toContain("już wprowadzony");
    expect(proposeServiceEntry(reading({ performedOn: "2026-12-24" }), subjects, today).warnings.join(" ")).toContain("w przyszłości");
    expect(proposeServiceEntry(reading({ performedOn: "2028-11-09", validUntil: "2028-11-09" }), subjects, today).warnings.join(" ")).toContain("nie jest późniejsza");
    expect(proposeServiceEntry(reading({ legible: false }), subjects, today).warnings[0]).toContain("mało czytelny");
  });

  it("treats malformed dates from the model as unreadable instead of trusting them", () => {
    const p = proposeServiceEntry(reading({ performedOn: "09.11.2026", validUntil: "2028-13-45" }), subjects, today);
    expect(p).toMatchObject({ performedOn: null, validUntil: null });
    expect(p.warnings.filter((w) => w.includes("nieczytelna lub niepoprawna"))).toHaveLength(2);
  });

  it("returns an empty proposal when there is no reading (AI unavailable)", () => {
    expect(proposeServiceEntry(null, subjects, today)).toMatchObject({ subjectId: null, termId: null, kind: null, warnings: [] });
  });

  it("has small helpers that do what they say", () => {
    expect(normalizePlates(" el 9k-41 ")).toBe("EL9K41");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonths("2026-11-09", 24)).toBe("2028-11-09");
  });
});
