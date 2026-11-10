import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { translateForDriver } from "@/ai/functions/translate-for-driver";
import { drivers } from "@/db/schema";
import { DRIVER_LANGUAGES } from "@/domain/driver-language";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readJson, withSandbox } from "@/server/http";
import { driverLanguage, sendToDriver } from "@/server/messages/gateway";
import { threadDetail } from "@/server/messages/threads";

const Body = z.union([
  z.object({ body: z.string().trim().min(1, "Wpisz treść wiadomości").max(500, "Najwyżej 500 znaków") }),
  // "Język kierowcy": which language the driver reads (system SMS, the order page, translated chat).
  z.object({ language: z.enum(DRIVER_LANGUAGES) }),
]);

export async function GET(request: NextRequest, ctx: RouteContext<"/api/messages/[driverId]">) {
  const { driverId } = await ctx.params;
  return withSandbox(request, ({ db, sandbox }) => threadDetail(db, sandbox.id, driverId));
}

/**
 * Dispatcher replies from the app instead of the phone. For a driver who reads Ukrainian or Russian
 * the Polish text is translated before it goes out; both versions stay in the thread. Without AI
 * (or when the translation lost a number or an order) the message goes out in Polish, and says so.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/messages/[driverId]">) {
  const { driverId } = await ctx.params;
  return withSandbox(request, async (c) => {
    const input = await readJson(c.request, Body);
    await threadDetail(c.db, c.sandbox.id, driverId);
    if ("language" in input) {
      await c.db.update(drivers).set({ language: input.language }).where(and(eq(drivers.sandboxId, c.sandbox.id), eq(drivers.id, driverId)));
      return threadDetail(c.db, c.sandbox.id, driverId);
    }
    return atCurrentTime(c, async (simNow) => {
      const language = await driverLanguage(c.db, c.sandbox.id, driverId);
      const translated = language === "pl" ? null : await translateForDriver({ db: c.db, sandboxId: c.sandbox.id, simNow, text: input.body, language });
      await sendToDriver(c.db, c.sandbox.id, { driverId, body: translated ?? input.body, translation: translated ? input.body : null, kind: "chat", sentBy: "dispatcher", atSim: simNow });
      return { ...(await threadDetail(c.db, c.sandbox.id, driverId)), sentUntranslated: language !== "pl" && !translated };
    });
  });
}
