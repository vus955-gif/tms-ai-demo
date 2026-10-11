import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { drivers } from "@/db/schema";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { HttpError, withSandbox } from "@/server/http";
import { storeDriverInbound } from "@/server/messages/gateway";
import { processDriverInbound, type UploadedImage } from "@/server/messages/inbound";

/** Below Vercel's 4.5 MB request limit and the API's per-image limit. */
const MAX_BYTES = 4 * 1024 * 1024;

function detectType(bytes: Uint8Array): UploadedImage["mediaType"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * The visitor (as a driver) sends their own photo of a document. It is read by
 * AI in this request and then discarded — the demo never stores uploads.
 */
export async function POST(request: NextRequest) {
  return withSandbox(request, async (c) => {
    const declared = Number(c.request.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES + 64 * 1024) throw new HttpError(413, "Zdjęcie jest za duże (najwyżej 4 MB).");
    let form: FormData;
    try {
      form = await c.request.formData();
    } catch {
      throw new HttpError(400, "Niepoprawny formularz — wyślij zdjęcie jako plik.");
    }
    const driverId = String(form.get("driverId") ?? "");
    const body = String(form.get("body") ?? "").trim().slice(0, 500);
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Dołącz zdjęcie.");
    if (file.size > MAX_BYTES) throw new HttpError(413, "Zdjęcie jest za duże (najwyżej 4 MB).");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mediaType = detectType(bytes);
    if (!mediaType) throw new HttpError(415, "Obsługiwane są tylko zdjęcia JPEG, PNG i WebP.");
    const [driver] = await c.db.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.sandboxId, c.sandbox.id), eq(drivers.id, driverId)));
    if (!driver) throw new HttpError(404, "Nie ma takiego kierowcy.");
    return atCurrentTime(c, async (simNow) => {
      const messageId = await storeDriverInbound(c.db, c.sandbox.id, {
        driverId,
        body: body || "Zdjęcie dokumentu",
        atSim: simNow,
        attachments: [{ notStored: true, name: file.name.slice(0, 80) }],
      });
      const uploaded: UploadedImage = { data: Buffer.from(bytes).toString("base64"), mediaType };
      const classification = await processDriverInbound(c.db, c.sandbox.id, messageId, { simNow, uploaded });
      return { messageId, classification };
    });
  });
}
