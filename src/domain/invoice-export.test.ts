import { describe, expect, it } from "vitest";
import { buildInvoiceCsv, invoiceCsvFilename, type InvoiceRow } from "./invoice-export";

const row = (over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  number: "ZL-1022",
  clientName: "Meble Wielkopolska Sp. z o.o.",
  clientTaxId: "7811234567",
  references: ["MW/2026/1022"],
  pickupName: "Fabryka Swarzędz",
  pickupCity: "Swarzędz",
  pickupCountry: "Polska",
  loadedAt: new Date("2026-11-08T05:55:00Z"),
  deliveryName: "Magazyn Berlin",
  deliveryCity: "Berlin",
  deliveryCountry: "Niemcy",
  unloadedAt: new Date("2026-11-08T10:40:00Z"),
  cargoPallets: 24,
  cargoKg: 7200,
  distanceKm: 271,
  distanceApprox: false,
  vehiclePlates: "PO 4K21",
  trailerPlates: "PO 77N3",
  driverName: "Jan Nowak",
  cmrOnFile: true,
  closedAt: new Date("2026-11-09T07:10:00Z"),
  ...over,
});

const lines = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

describe("invoice export (CSV)", () => {
  it("writes what Polish Excel opens without a wizard: BOM, semicolons, CRLF, local dates", () => {
    const csv = buildInvoiceCsv([row()]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    const [header, first] = lines(csv);
    expect(header.split(";")).toHaveLength(21);
    expect(header).toContain("Numer zlecenia;Klient;NIP");
    // 05:55 UTC on 8 November is 06:55 in Warsaw (winter time).
    expect(first).toBe(
      "ZL-1022;Meble Wielkopolska Sp. z o.o.;7811234567;MW/2026/1022;Fabryka Swarzędz;Swarzędz;Polska;08.11.2026 06:55;Magazyn Berlin;Berlin;Niemcy;08.11.2026 11:40;24;7200;271;nie;PO 4K21;PO 77N3;Jan Nowak;jest;09.11.2026 08:10",
    );
  });

  it("quotes cells with separators, quotes and line breaks", () => {
    const [, first] = lines(buildInvoiceCsv([row({ clientName: 'Firma "Alfa"; oddział 2', references: ["A-1", "B-2"] })]));
    expect(first).toContain('"Firma ""Alfa""; oddział 2"');
    expect(first).toContain(";A-1, B-2;");
  });

  it("stops a spreadsheet from running client-supplied text as a formula", () => {
    const [, first] = lines(buildInvoiceCsv([row({ clientName: "=HYPERLINK(\"http://zly.example\")", references: ["+48 600 100 200", "@ref", "-5"] })]));
    expect(first).toContain(`"'=HYPERLINK(""http://zly.example"")"`);
    expect(first).toContain(";'+48 600 100 200, @ref, -5;");
  });

  it("leaves unknown values empty and marks estimated distances", () => {
    const [, first] = lines(buildInvoiceCsv([row({ distanceKm: null, distanceApprox: true, cmrOnFile: false, closedAt: null, trailerPlates: "" })]));
    const cells = first.split(";");
    expect(cells[14]).toBe("");
    expect(cells[15]).toBe("tak");
    expect(cells[17]).toBe("");
    expect(cells[19]).toBe("brak");
    expect(cells[20]).toBe("");
  });

  it("names the file after the Warsaw date", () => {
    // 23:30 UTC is already the next day in Warsaw.
    expect(invoiceCsvFilename(new Date("2026-11-10T23:30:00Z"))).toBe("zlecenia-do-faktur-2026-11-11.csv");
  });
});
