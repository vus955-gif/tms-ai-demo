import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { testPdf } from "@/test/pdf";
import { countPdfPages } from "./pdf-pages";

describe("countPdfPages", () => {
  it("counts the page objects of a plain PDF", () => {
    expect(countPdfPages(testPdf(1))).toBe(1);
    expect(countPdfPages(testPdf(12))).toBe(12);
  });

  it("counts pages packed into compressed object streams", () => {
    expect(countPdfPages(testPdf(3, { objectStreams: true }))).toBe(3);
    expect(countPdfPages(testPdf(40, { objectStreams: true }))).toBe(40);
  });

  it("does not count the page tree as a page", () => {
    expect(countPdfPages(new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n"))).toBe(0);
  });

  it("says 0 when it cannot tell", () => {
    expect(countPdfPages(new TextEncoder().encode("%PDF-1.7 fikcyjna polisa"))).toBe(0);
    // An object stream that does not unpack (e.g. encrypted).
    const broken = "%PDF-1.7\n5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode >>\nstream\nnot zlib\nendstream\nendobj\n";
    expect(countPdfPages(new TextEncoder().encode(broken))).toBe(0);
  });

  it("does not unpack an object stream beyond the size cap", () => {
    const bomb = deflateSync(Buffer.alloc(20 * 1024 * 1024, " "));
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.7\n5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode >>\nstream\n", "latin1"),
      bomb,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    ]);
    expect(countPdfPages(pdf)).toBe(0);
  });
});
