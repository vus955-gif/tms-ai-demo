import { deflateSync } from "node:zlib";

/**
 * A minimal valid PDF with `pages` empty pages (tests only). `objectStreams` packs the page objects into
 * a compressed object stream, the way PDF 1.5+ writers often do.
 */
export function testPdf(pages: number, opts: { objectStreams?: boolean } = {}): Uint8Array<ArrayBuffer> {
  const pageIds = Array.from({ length: pages }, (_, i) => i + 3);
  const page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>";
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const add = (body: string | Buffer) => parts.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);

  add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  add(`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>\nendobj\n`);
  if (opts.objectStreams) {
    const offsets: string[] = [];
    let body = "";
    for (const id of pageIds) {
      offsets.push(`${id} ${body.length}`);
      body += `${page}\n`;
    }
    const header = `${offsets.join(" ")}\n`;
    const packed = deflateSync(Buffer.from(header + body, "latin1"));
    const id = pages + 3;
    add(`${id} 0 obj\n<< /Type /ObjStm /N ${pages} /First ${header.length} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`);
    add(packed);
    add("\nendstream\nendobj\n");
  } else {
    for (const id of pageIds) add(`${id} 0 obj\n${page}\nendobj\n`);
  }
  add("trailer\n<< /Root 1 0 R >>\n%%EOF\n");
  return new Uint8Array(Buffer.concat(parts));
}
