import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { drivers } from "@/db/schema";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { HttpError, readJson, withSandbox } from "@/server/http";
import { storeDriverInbound } from "@/server/messages/gateway";
import { processDriverInbound } from "@/server/messages/inbound";
import { cmrSample } from "@/simulation/scenario/cmr-samples";

const Body = z.object({
  driverId: z.string().min(1).max(64),
  body: z.string().trim().max(500, "Najwyżej 500 znaków"),
  sampleId: z.string().max(64).optional(),
});

/** The visitor writes as a driver; the message goes through the same AI classification. */
export async function POST(request: NextRequest) {
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    if (!input.body && !input.sampleId) throw new HttpError(400, "Wpisz treść wiadomości albo dołącz zdjęcie.");
    if (input.sampleId && !cmrSample(input.sampleId)) throw new HttpError(400, "Nie ma takiego przykładowego zdjęcia.");
    const [driver] = await c.db.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.sandboxId, c.sandbox.id), eq(drivers.id, input.driverId)));
    if (!driver) throw new HttpError(404, "Nie ma takiego kierowcy.");
    return atCurrentTime(c, async (simNow) => {
      const messageId = await storeDriverInbound(c.db, c.sandbox.id, {
        driverId: input.driverId,
        body: input.body,
        atSim: simNow,
        attachments: input.sampleId ? [{ sampleId: input.sampleId }] : [],
      });
      const classification = await processDriverInbound(c.db, c.sandbox.id, messageId, { simNow });
      return { messageId, classification };
    });
  });
}
