import type { NextRequest } from "next/server";
import { HttpError } from "../http";
import type { UploadedImage } from "./inbound";

/** Below Vercel's 4.5 MB request limit and the API's per-image limit. */
const MAX_BYTES = 4 * 1024 * 1024;

/** The real type by the file's first bytes — the declared name and MIME type are the sender's word only. */
function detectType(bytes: Uint8Array): UploadedImage["mediaType"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Reads one photo from a multipart form (field "file"). The image is handed to AI within this
 * request and then discarded — the demo never stores uploads.
 */
export async function readPhotoUpload(request: NextRequest): Promise<{ form: FormData; name: string; uploaded: UploadedImage }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES + 64 * 1024) throw new HttpError(413, "Zdjęcie jest za duże (najwyżej 4 MB).");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Niepoprawny formularz — wyślij zdjęcie jako plik.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Dołącz zdjęcie.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Zdjęcie jest za duże (najwyżej 4 MB).");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = detectType(bytes);
  if (!mediaType) throw new HttpError(415, "Obsługiwane są tylko zdjęcia JPEG, PNG i WebP.");
  return { form, name: file.name, uploaded: { data: Buffer.from(bytes).toString("base64"), mediaType } };
}
