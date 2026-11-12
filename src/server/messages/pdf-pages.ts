import { inflateSync } from "node:zlib";

/** "/Type /Page" (a page object), not "/Type /Pages" (the page tree). */
const PAGE = /\/Type\s*\/Page(?![A-Za-z])/g;
/** Start of a stream's data ("endstream" is not one). */
const STREAM_START = /(?<!end)stream(?:\r\n|\n|\r)/g;
/** An object stream may unpack to at most this much; anything bigger is not a service document. */
const MAX_UNPACKED = 8 * 1024 * 1024;

/**
 * Counts the pages of a PDF without a PDF library: page objects in the file plus those packed into
 * compressed object streams (PDF 1.5+). An approximation — an edited file may still hold old copies of
 * its pages, so it can only count too many, never too few for the files it reads. 0 = could not tell
 * (encrypted or damaged file).
 */
export function countPdfPages(bytes: Uint8Array): number {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = buffer.toString("latin1");
  let pages = text.match(PAGE)?.length ?? 0;
  if (!text.includes("/ObjStm")) return pages;

  for (const match of text.matchAll(STREAM_START)) {
    const start = match.index + match[0].length;
    const dictionary = text.slice(Math.max(text.lastIndexOf("obj", match.index), 0), match.index);
    if (!/\/Type\s*\/ObjStm/.test(dictionary) || !/\/FlateDecode/.test(dictionary)) continue;
    const end = text.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      const unpacked = inflateSync(buffer.subarray(start, end), { maxOutputLength: MAX_UNPACKED }).toString("latin1");
      pages += unpacked.match(PAGE)?.length ?? 0;
    } catch {
      // Not readable (encrypted, damaged, too big): pages inside it stay uncounted.
    }
  }
  return pages;
}
