import { formatWarsaw } from "@/lib/format";

/** One closed order, flattened to what invoicing needs. */
export type InvoiceRow = {
  number: string;
  clientName: string;
  clientTaxId: string;
  references: string[];
  pickupName: string;
  pickupCity: string;
  pickupCountry: string;
  /** Actual departure from loading when known, otherwise the end of the agreed window. */
  loadedAt: Date;
  deliveryName: string;
  deliveryCity: string;
  deliveryCountry: string;
  /** Actual end of unloading when known, otherwise the end of the agreed window. */
  unloadedAt: Date;
  cargoPallets: number;
  cargoKg: number;
  distanceKm: number | null;
  /** The distance comes from a straight-line estimate, not from a road route. */
  distanceApprox: boolean;
  vehiclePlates: string;
  trailerPlates: string;
  driverName: string;
  cmrOnFile: boolean;
  closedAt: Date | null;
};

const HEADERS = [
  "Numer zlecenia",
  "Klient",
  "NIP",
  "Referencje klienta",
  "Załadunek",
  "Miejscowość załadunku",
  "Kraj załadunku",
  "Data załadunku",
  "Rozładunek",
  "Miejscowość rozładunku",
  "Kraj rozładunku",
  "Data rozładunku",
  "Palety",
  "Waga (kg)",
  "Dystans (km)",
  "Dystans szacowany",
  "Pojazd",
  "Naczepa",
  "Kierowca",
  "Skan CMR",
  "Data zamknięcia",
] as const;

const DATE = "dd.MM.yyyy HH:mm";

/**
 * A cell that starts with = + - @ (or a tab / carriage return) is run as a formula by Excel and LibreOffice.
 * Client names, references and notes come from e-mails and forms, so such cells get a leading apostrophe.
 */
function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value: string | number): string {
  if (typeof value === "number") return String(value);
  const safe = neutralise(value);
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * CSV the way Polish Excel opens it without an import wizard: semicolons, CRLF line ends,
 * UTF-8 with a byte-order mark (otherwise ą/ę/ł turn into garbage), dates as dd.MM.yyyy HH:mm.
 */
export function buildInvoiceCsv(rows: InvoiceRow[]): string {
  const lines = [
    HEADERS.map(cell).join(";"),
    ...rows.map((r) =>
      [
        r.number,
        r.clientName,
        r.clientTaxId,
        r.references.join(", "),
        r.pickupName,
        r.pickupCity,
        r.pickupCountry,
        formatWarsaw(r.loadedAt, DATE),
        r.deliveryName,
        r.deliveryCity,
        r.deliveryCountry,
        formatWarsaw(r.unloadedAt, DATE),
        r.cargoPallets,
        r.cargoKg,
        r.distanceKm ?? "",
        r.distanceApprox ? "tak" : "nie",
        r.vehiclePlates,
        r.trailerPlates,
        r.driverName,
        r.cmrOnFile ? "jest" : "brak",
        r.closedAt ? formatWarsaw(r.closedAt, DATE) : "",
      ]
        .map(cell)
        .join(";"),
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** "zlecenia-do-faktur-2026-11-10.csv" */
export function invoiceCsvFilename(at: Date): string {
  return `zlecenia-do-faktur-${formatWarsaw(at, "yyyy-MM-dd")}.csv`;
}
