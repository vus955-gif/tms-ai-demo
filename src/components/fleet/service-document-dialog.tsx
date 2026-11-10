"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FALLBACK_REASON_LABEL } from "@/components/shell/ai-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SNAPSHOT_KEY } from "@/hooks/use-snapshot";
import { ApiError, getJson, postJson } from "@/lib/api";
import { formatWarsaw } from "@/lib/format";
import type { ServiceDocumentResult } from "@/server/fleet/service-documents";
import type { FleetFileView, SubjectView } from "@/server/fleet/views";

type Sample = { id: string; label: string; file: string };
const SERVICE_KINDS = ["przeglad", "oc", "tachograf", "serwis", "atp"];

async function readUpload(file: File): Promise<ServiceDocumentResult> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch("/api/fleet/documents", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as ServiceDocumentResult & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Błąd serwera (${res.status})`);
  return body;
}

/**
 * "Dokument serwisowy": AI reads a photo or PDF and proposes one entry in the fleet file.
 * The form is always editable and nothing is saved until the dispatcher presses "Zapisz w kartotece".
 */
export function ServiceDocumentDialog({ fleet, onClose }: { fleet: FleetFileView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const samples = useQuery({ queryKey: ["fleet-doc-samples"], queryFn: () => getJson<{ samples: Sample[] }>("/api/fleet/documents"), staleTime: Infinity });
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ url: string | null; name: string } | null>(null);
  const [result, setResult] = useState<ServiceDocumentResult | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [termId, setTermId] = useState("");
  const [performedOn, setPerformedOn] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [nextKm, setNextKm] = useState("");
  const [docNumber, setDocNumber] = useState("");

  // A local preview of the visitor's own file lives only in this browser tab.
  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [preview]);

  const subjects: SubjectView[] = [...fleet.vehicles, ...fleet.trailers].sort((a, b) => a.title.localeCompare(b.title, "pl"));
  const subject = subjects.find((s) => s.id === subjectId);
  const terms = (subject?.terms ?? []).filter((t) => SERVICE_KINDS.includes(t.kind));
  const term = terms.find((t) => t.id === termId);
  const byKm = term?.kind === "serwis";

  const apply = (r: ServiceDocumentResult) => {
    const p = r.proposal;
    setResult(r);
    setSubjectId(p.subjectId ?? "");
    setTermId(p.termId ?? "");
    setPerformedOn(p.performedOn ?? "");
    setValidUntil(p.validUntil ?? "");
    setNextKm(p.nextKm === null ? "" : String(p.nextKm));
    setDocNumber(p.docNumber);
  };

  const read = useMutation({
    mutationFn: (input: { sample: Sample } | { file: File }) => ("sample" in input ? postJson<ServiceDocumentResult>("/api/fleet/documents", { sampleId: input.sample.id }) : readUpload(input.file)),
    onMutate: (input) => {
      setResult(null);
      setPreview("sample" in input ? { url: input.sample.file, name: input.sample.label } : { url: input.file.type.startsWith("image/") ? URL.createObjectURL(input.file) : null, name: input.file.name });
    },
    onSuccess: apply,
    onError: (e) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () =>
      postJson<{ summary: string }>(`/api/fleet/terms/${encodeURIComponent(termId)}`, {
        action: "record",
        performedOn: performedOn || null,
        validUntil: byKm ? null : validUntil || null,
        nextKm: byKm && nextKm ? Number(nextKm) : null,
        docNumber,
      }),
    onSuccess: (r) => {
      toast.success(`Zapisano w kartotece. ${r.summary}.`);
      void queryClient.invalidateQueries({ queryKey: ["fleet"] });
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      onClose();
    },
  });

  const canSave = Boolean(term) && (byKm ? /^\d+$/.test(nextKm) : Boolean(validUntil)) && !save.isPending;
  const current = term ? (term.dueKm !== null ? `${term.dueKm} km` : term.dueSim ? formatWarsaw(term.dueSim, "dd.MM.yyyy") : "brak") : null;
  const select = "h-9 w-full rounded-md border bg-background px-2 text-sm";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-y-auto sm:max-w-3xl" data-testid="service-doc-dialog">
        <DialogHeader>
          <DialogTitle>Dokument serwisowy</DialogTitle>
          <DialogDescription>
            Zaświadczenie o badaniu, polisa OC, protokół legalizacji tachografu albo serwisu. AI odczyta dokument i zaproponuje wpis; do kartoteki trafi dopiero to, co zatwierdzisz.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            {samples.data?.samples.map((s) => (
              <Button key={s.id} size="sm" variant="outline" onClick={() => read.mutate({ sample: s })} disabled={read.isPending} data-testid={`service-sample-${s.id}`}>
                {s.label}
              </Button>
            ))}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              aria-label="Plik dokumentu serwisowego"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) read.mutate({ file });
              }}
            />
            <Button size="sm" onClick={() => fileInput.current?.click()} disabled={read.isPending}>
              <FileUp /> Własny plik (zdjęcie lub PDF)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Przykładowe dokumenty są fikcyjne. Własny plik jest odczytywany i od razu odrzucany: demo go nie przechowuje.</p>
        </div>

        {read.isPending && (
          <p className="flex items-center gap-2 text-sm text-ai" role="status">
            <Sparkles className="size-4" aria-hidden /> Czytam dokument…
          </p>
        )}

        {result && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              {preview?.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- demo sample or a local preview of the visitor's own file
                <img src={preview.url} alt={`Dokument: ${preview.name}`} className="max-h-[420px] w-full rounded-md border bg-white object-contain" />
              ) : (
                <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">{preview?.name} — podglądu PDF nie ma, porównaj wpis z plikiem na swoim komputerze.</p>
              )}
            </div>

            <form
              className="grid content-start gap-3 text-sm"
              data-testid="service-doc-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSave) save.mutate();
              }}
            >
              {result.source === "ai" ? (
                <p className="flex items-start gap-2 rounded-md bg-ai-soft p-2 text-xs text-ai" data-testid="service-doc-source">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Odczytane przez AI. Sprawdź każde pole z dokumentem, zanim zapiszesz.
                </p>
              ) : (
                <p className="rounded-md bg-warn-soft p-2 text-xs text-warn" data-testid="service-doc-source">
                  AI nie odczytało dokumentu: {(FALLBACK_REASON_LABEL[result.reason ?? ""] ?? "AI chwilowo niedostępne.").replace(/\.$/, "")}. Wpisz dane z dokumentu ręcznie.
                </p>
              )}
              {result.proposal.warnings.length > 0 && (
                <ul className="grid gap-1 rounded-md border border-warn/50 bg-warn-soft p-2 text-xs text-warn" data-testid="service-doc-warnings">
                  {result.proposal.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-1.5">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w}
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid gap-1.5">
                <Label htmlFor="sd-subject">Pojazd lub naczepa</Label>
                <select
                  id="sd-subject"
                  className={select}
                  value={subjectId}
                  onChange={(e) => {
                    setSubjectId(e.target.value);
                    setTermId("");
                  }}
                >
                  <option value="">— wybierz —</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} ({s.type === "trailer" ? "naczepa" : s.subtitle.split(" · ")[0]})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sd-term">Rodzaj terminu</Label>
                <select id="sd-term" className={select} value={termId} onChange={(e) => setTermId(e.target.value)} disabled={!subject}>
                  <option value="">— wybierz —</option>
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {current && <p className="text-xs text-muted-foreground">Teraz w kartotece: {current}.</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sd-performed">Data wykonania</Label>
                <Input id="sd-performed" type="date" value={performedOn} onChange={(e) => setPerformedOn(e.target.value)} />
              </div>
              {byKm ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="sd-km">Następny serwis przy (km)</Label>
                  <Input id="sd-km" inputMode="numeric" value={nextKm} onChange={(e) => setNextKm(e.target.value.replace(/\D/g, ""))} />
                  <p className="text-xs text-muted-foreground">Wyliczone: przebieg z dokumentu plus interwał serwisowy pojazdu.</p>
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="sd-until">Ważne do</Label>
                  <Input id="sd-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                  {result.proposal.validUntilSource && validUntil === result.proposal.validUntil && (
                    <p className="text-xs text-muted-foreground">{result.proposal.validUntilSource === "dokument" ? "Data przepisana z dokumentu." : "Dokument nie podaje daty ważności: wyliczono ją z daty wykonania według reguły dla tego terminu."}</p>
                  )}
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="sd-number">Numer dokumentu</Label>
                <Input id="sd-number" value={docNumber} maxLength={60} onChange={(e) => setDocNumber(e.target.value)} />
              </div>
              {save.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {save.error.message}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                  Anuluj
                </Button>
                <Button type="submit" disabled={!canSave} data-testid="service-doc-save">
                  {save.isPending ? "Zapisuję…" : "Zapisz w kartotece"}
                </Button>
              </DialogFooter>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
