import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { drivers } from "@/db/schema";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { HttpError, withSandbox } from "@/server/http";
import { storeDriverInbound } from "@/server/messages/gateway";
import { processDriverInbound } from "@/server/messages/inbound";
import { readPhotoUpload } from "@/server/messages/photo-upload";

/**
 * The visitor (as a driver) sends their own photo of a document. It is read by
 * AI in this request and then discarded — the demo never stores uploads.
 */
export async function POST(request: NextRequest) {
  return withSandbox(request, async (c) => {
    const { form, name, uploaded } = await readPhotoUpload(c.request);
    const driverId = String(form.get("driverId") ?? "");
    const body = String(form.get("body") ?? "").trim().slice(0, 500);
    const [driver] = await c.db.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.sandboxId, c.sandbox.id), eq(drivers.id, driverId)));
    if (!driver) throw new HttpError(404, "Nie ma takiego kierowcy.");
    return atCurrentTime(c, async (simNow) => {
      const messageId = await storeDriverInbound(c.db, c.sandbox.id, {
        driverId,
        body: body || "Zdjęcie dokumentu",
        atSim: simNow,
        attachments: [{ notStored: true, name: name.slice(0, 80) }],
      });
      const classification = await processDriverInbound(c.db, c.sandbox.id, messageId, { simNow, uploaded });
      return { messageId, classification };
    });
  });
}
