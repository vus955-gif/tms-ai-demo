import { TZDate } from "@date-fns/tz";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { readServiceDocument, type ServiceDocumentFile } from "@/ai/functions/read-service-document";
import type { AiFallbackReason } from "@/ai/run-structured";
import { fleetTerms, trailers, vehicles } from "@/db/schema";
import type { Executor } from "@/db/types";
import { TERM_LABEL } from "@/domain/fleet-terms";
import { parseDay, proposeServiceEntry, SERVICE_KINDS, type ServiceKind, type ServiceProposal, type ServiceSubject } from "@/domain/service-document";
import { formatWarsaw } from "@/lib/format";
import { SERVICE_INTERVAL_KM } from "@/simulation/scenario/fleet-file";
import { serviceSample } from "@/simulation/scenario/service-samples";
import { HttpError } from "../http";
import { ensureFleetFile } from "./seed";

const SAMPLES_DIR = path.join(process.cwd(), "public", "service-samples");
const isServiceKind = (kind: string): kind is ServiceKind => (SERVICE_KINDS as readonly string[]).includes(kind);

export type ServiceDocumentResult = { source: "ai" | "fallback"; reason: AiFallbackReason | null; proposal: ServiceProposal };

function loadSample(sampleId: string): ServiceDocumentFile {
  const sample = serviceSample(sampleId);
  if (!sample) throw new HttpError(400, "Nie ma takiego przykładowego dokumentu.");
  const file = path.join(SAMPLES_DIR, path.basename(sample.file));
  if (!existsSync(/*turbopackIgnore: true*/ file)) throw new HttpError(500, "Brakuje pliku przykładowego dokumentu.");
  return { data: readFileSync(/*turbopackIgnore: true*/ file).toString("base64"), mediaType: "image/jpeg" };
}

async function loadSubjects(db: Executor, sandboxId: string): Promise<ServiceSubject[]> {
  const [terms, vs, ts] = await Promise.all([
    db.select().from(fleetTerms).where(eq(fleetTerms.sandboxId, sandboxId)),
    db.select().from(vehicles).where(eq(vehicles.sandboxId, sandboxId)),
    db.select().from(trailers).where(eq(trailers.sandboxId, sandboxId)),
  ]);
  const own = (id: string) => terms.filter((t) => t.subjectId === id && isServiceKind(t.kind)).map((t) => ({ id: t.id, kind: t.kind, dueSim: t.dueSim, dueKm: t.dueKm }));
  return [
    ...vs.map((v): ServiceSubject => ({ id: v.id, type: "vehicle", plates: v.plates, odometerKm: v.odometerKm, serviceIntervalKm: SERVICE_INTERVAL_KM[v.kind], terms: own(v.id) })),
    ...ts.map((t): ServiceSubject => ({ id: t.id, type: "trailer", plates: t.plates, odometerKm: null, serviceIntervalKm: 0, terms: own(t.id) })),
  ];
}

/**
 * Reads a service document and proposes one entry in the fleet file. Nothing is saved here:
 * the proposal goes back to the dispatcher, who checks it against the document and approves it.
 * The document itself is read within this request and discarded — the demo stores no uploads.
 */
export async function readFleetDocument(
  db: Executor,
  sandbox: { id: string; simOrigin: Date; seed: number },
  simNow: Date,
  input: { sampleId: string } | { file: ServiceDocumentFile; name: string },
): Promise<ServiceDocumentResult> {
  await ensureFleetFile(db, sandbox);
  const file = "sampleId" in input ? loadSample(input.sampleId) : input.file;
  const inputRef = "sampleId" in input ? `przykład: ${input.sampleId}` : `plik: ${input.name.slice(0, 60)}`;
  const outcome = await readServiceDocument({ db, sandboxId: sandbox.id, simNow, file, inputRef });
  const r = outcome.value;
  const reading = r && {
    legible: r.legible,
    docKind: r.doc_kind,
    plates: r.plates,
    performedOn: r.performed_on,
    validUntil: r.valid_until,
    odometerKm: r.odometer_km,
    docNumber: r.doc_number,
    issuer: r.issuer,
  };
  return { source: outcome.source, reason: outcome.reason ?? null, proposal: proposeServiceEntry(reading, await loadSubjects(db, sandbox.id), simNow) };
}

const warsawMidnight = (day: Date, plusDays = 0) => new Date(new TZDate(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + plusDays, 0, 0, "Europe/Warsaw").getTime());

export type RecordInput = { performedOn: string | null; validUntil: string | null; nextKm: number | null; docNumber: string };

/**
 * "Zapisz w kartotece": the dispatcher approves an entry from a document (read by AI or typed in).
 * Date terms take the validity date, the mileage service takes the odometer of the next service.
 */
export async function recordFleetTerm(db: Executor, sandboxId: string, termId: string, input: RecordInput, simNow: Date): Promise<{ summary: string }> {
  const [term] = await db.select().from(fleetTerms).where(and(eq(fleetTerms.sandboxId, sandboxId), eq(fleetTerms.id, termId)));
  if (!term) throw new HttpError(404, "Nie ma takiego terminu.");
  if (term.subjectType === "driver" || !isServiceKind(term.kind)) throw new HttpError(400, "Z dokumentu serwisowego można odnowić tylko terminy pojazdu lub naczepy.");

  const performed = input.performedOn ? parseDay(input.performedOn) : null;
  if (input.performedOn && !performed) throw new HttpError(400, "Podaj datę wykonania w formacie RRRR-MM-DD.");
  if (performed && warsawMidnight(performed).getTime() > simNow.getTime()) throw new HttpError(400, "Data wykonania nie może być w przyszłości.");
  const doneSim = performed ? warsawMidnight(performed) : simNow;
  const docNumber = input.docNumber.trim().slice(0, 60);

  const [vehicle] = term.subjectType === "vehicle" ? await db.select().from(vehicles).where(and(eq(vehicles.sandboxId, sandboxId), eq(vehicles.id, term.subjectId))) : [];
  const [trailer] = term.subjectType === "trailer" ? await db.select().from(trailers).where(and(eq(trailers.sandboxId, sandboxId), eq(trailers.id, term.subjectId))) : [];
  const plates = vehicle?.plates ?? trailer?.plates ?? term.subjectId;

  if (term.kind === "serwis") {
    const nextKm = input.nextKm;
    if (nextKm === null || !Number.isInteger(nextKm)) throw new HttpError(400, "Podaj przebieg następnego serwisu w kilometrach.");
    const odometer = vehicle?.odometerKm ?? 0;
    if (nextKm <= odometer) throw new HttpError(400, `Następny serwis musi być powyżej obecnego przebiegu (${odometer} km).`);
    if (nextKm > odometer + 300_000) throw new HttpError(400, "Przebieg następnego serwisu wygląda na pomyłkę: to ponad 300 000 km od dziś.");
    await db.update(fleetTerms).set({ dueSim: null, dueKm: nextKm, doneSim, ...(docNumber && { docNumber }) }).where(and(eq(fleetTerms.sandboxId, sandboxId), eq(fleetTerms.id, termId)));
    return { summary: `${plates}: ${TERM_LABEL[term.kind]}, następny przy ${nextKm} km` };
  }

  const until = input.validUntil ? parseDay(input.validUntil) : null;
  if (!until) throw new HttpError(400, "Podaj datę ważności w formacie RRRR-MM-DD.");
  if (performed && until.getTime() <= performed.getTime()) throw new HttpError(400, "Data ważności musi być późniejsza niż data wykonania.");
  // Valid through the whole printed day: the term lapses at the next Warsaw midnight.
  const dueSim = warsawMidnight(until, 1);
  if (dueSim.getTime() <= simNow.getTime()) throw new HttpError(400, "Ten termin już minął. Taki wpis nie odblokuje pojazdu; sprawdź, czy to aktualny dokument.");
  if (dueSim.getTime() > simNow.getTime() + 20 * 366 * 86_400_000) throw new HttpError(400, "Data ważności wygląda na pomyłkę: to ponad 20 lat od dziś.");
  await db.update(fleetTerms).set({ dueSim, dueKm: null, doneSim, ...(docNumber && { docNumber }) }).where(and(eq(fleetTerms.sandboxId, sandboxId), eq(fleetTerms.id, termId)));
  return { summary: `${plates}: ${TERM_LABEL[term.kind]} ważne do ${formatWarsaw(until, "dd.MM.yyyy")}` };
}
