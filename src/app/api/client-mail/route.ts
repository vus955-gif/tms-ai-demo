import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { clientContacts, clients } from "@/db/schema";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { HttpError, readJson, withSandbox } from "@/server/http";
import { storeClientInbound } from "@/server/inbox/gateway";
import { processClientEmail } from "@/server/inbox/process";

export type MailClient = { id: string; name: string; contacts: { id: string; name: string; email: string }[] };

/** "Poczta klienta": the demo's fictional clients and their contacts. */
export async function GET(request: NextRequest) {
  return withSandbox(request, async ({ db, sandbox }) => {
    const [cls, contacts] = await Promise.all([
      db.select().from(clients).where(eq(clients.sandboxId, sandbox.id)),
      db.select().from(clientContacts).where(eq(clientContacts.sandboxId, sandbox.id)),
    ]);
    const list: MailClient[] = cls
      .sort((a, b) => a.name.localeCompare(b.name, "pl"))
      .map((c) => ({ id: c.id, name: c.name, contacts: contacts.filter((x) => x.clientId === c.id).map((x) => ({ id: x.id, name: x.name, email: x.email })) }));
    return { clients: list };
  });
}

const Body = z.object({
  contactId: z.string().min(1).max(64),
  subject: z.string().trim().min(1, "Wpisz temat").max(200, "Temat do 200 znaków"),
  body: z.string().trim().min(1, "Wpisz treść").max(4000, "Najwyżej 4000 znaków"),
});

/** The visitor writes as a client; the e-mail goes through the same AI triage as scripted ones. */
export async function POST(request: NextRequest) {
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    const [contact] = await c.db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, c.sandbox.id), eq(clientContacts.id, input.contactId)));
    if (!contact) throw new HttpError(404, "Nie ma takiej osoby kontaktowej.");
    return atCurrentTime(c, async (simNow) => {
      const rootId = await storeClientInbound(c.db, c.sandbox.id, { ...input, atSim: simNow });
      const triage = await processClientEmail(c.db, c.sandbox.id, rootId, { simNow });
      return { rootId, category: triage.category };
    });
  });
}
