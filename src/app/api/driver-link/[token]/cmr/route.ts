import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { withDriverLink } from "@/server/driver-link/http";
import { cmrByDriver } from "@/server/driver-link/links";
import { readJson } from "@/server/http";
import { readPhotoUpload } from "@/server/messages/photo-upload";

const Sample = z.object({ sampleId: z.string().min(1).max(64) });

/**
 * CMR photo from the driver's page: a real photo (multipart, read by AI and discarded)
 * or, in the demo, one of the sample documents prepared for this order (JSON).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/driver-link/[token]/cmr">) {
  const { token } = await ctx.params;
  return withDriverLink(async (db) => {
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const { sampleId } = await readJson(request, Sample);
      return cmrByDriver(db, token, { sampleId }, new Date());
    }
    const { name, uploaded } = await readPhotoUpload(request);
    return cmrByDriver(db, token, { uploaded, name }, new Date());
  });
}
