import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { clientContacts, messages } from "@/db/schema";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { HttpError, readJson, withSandbox } from "@/server/http";
import { ordersBoard } from "@/server/orders/board";
import { createOrder, NewOrderSchema } from "@/server/orders/create";

/** Orders board: new orders, AI drafts and each driver's current order and queue. */
export async function GET(request: NextRequest) {
  return withSandbox(request, ({ db, sandbox }) => ordersBoard(db, sandbox.id));
}

/**
 * Dispatcher creates a new order from the form. `sourceMessageId` links it to
 * a client e-mail the AI could not turn into a complete draft.
 */
export async function POST(request: NextRequest) {
  return withSandbox(request, async (ctx) => {
    const { sourceMessageId, ...rest } = await readJson(ctx.request, z.record(z.string(), z.unknown()));
    const parsed = NewOrderSchema.safeParse(rest);
    if (!parsed.success) throw new HttpError(400, `Niepoprawne dane: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    const input = parsed.data;
    let linked: string | null = null;
    if (typeof sourceMessageId === "string") {
      const [mail] = await ctx.db.select().from(messages).where(and(eq(messages.sandboxId, ctx.sandbox.id), eq(messages.id, sourceMessageId), eq(messages.party, "client")));
      const [contact] = mail?.clientContactId
        ? await ctx.db.select().from(clientContacts).where(and(eq(clientContacts.sandboxId, ctx.sandbox.id), eq(clientContacts.id, mail.clientContactId)))
        : [];
      if (!contact || contact.clientId !== input.clientId) throw new HttpError(400, "Mail nie pochodzi od tego klienta.");
      linked = mail.id;
    }
    return atCurrentTime(ctx, async (simNow) => {
      const created = await createOrder(ctx.db, ctx.sandbox.id, input, {
        simNow,
        source: linked ? "email" : "manual",
        sourceMessageId: linked,
        actor: "dispatcher",
        reason: linked ? "Zlecenie założone przez spedytora z maila klienta" : undefined,
      });
      if (linked) await ctx.db.update(messages).set({ orderId: created.id }).where(and(eq(messages.sandboxId, ctx.sandbox.id), eq(messages.id, linked)));
      return created;
    });
  });
}
