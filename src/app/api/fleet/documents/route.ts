import type { NextRequest } from "next/server";
import { z } from "zod";
import "@/server/bootstrap";
import { atCurrentTime } from "@/server/actions";
import { readFleetDocument } from "@/server/fleet/service-documents";
import { readJson, withSandbox } from "@/server/http";
import { readDocumentUpload } from "@/server/messages/photo-upload";
import { serviceSamples } from "@/simulation/scenario/service-samples";

const Sample = z.object({ sampleId: z.string().min(1).max(64) });

/** Sample service documents of the demo (for visitors without a real one at hand). */
export async function GET(request: NextRequest) {
  return withSandbox(request, async () => ({ samples: serviceSamples.map((s) => ({ id: s.id, label: s.label, file: s.file })) }));
}

/**
 * "Dokument serwisowy": a photo or PDF (multipart) or a demo sample (JSON) is read by AI and comes
 * back as a proposal for one fleet-file entry. Nothing is saved until the dispatcher approves it.
 */
export async function POST(request: NextRequest) {
  return withSandbox(request, async (c) => {
    const input = c.request.headers.get("content-type")?.startsWith("application/json")
      ? await readJson(c.request, Sample)
      : await readDocumentUpload(c.request).then((u) => ({ file: u.uploaded, name: u.name }));
    return atCurrentTime(c, (simNow) => readFleetDocument(c.db, c.sandbox, simNow, input));
  });
}
