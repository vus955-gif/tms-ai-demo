"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatSimClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HandoverView as Data } from "@/server/handover/handover";

const SOURCE: Record<string, string> = { ai: "napisana z pomocą AI", rules: "z zestawienia, bez AI", reczna: "napisana ręcznie" };
const TONE: Record<string, string> = { Pilne: "border-bad/50 bg-bad-soft/60", "Do dopilnowania": "border-warn/50 bg-warn-soft/60" };

/**
 * "Przekazanie zmiany": on the left what the system knows right now, most urgent first; on the right
 * the note for the next dispatcher. AI drafts it from those facts, the person leaving the shift edits and saves it.
 */
export function HandoverView() {
  const { data: snapshot } = useSnapshot();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["handover", snapshot?.simNow], queryFn: () => getJson<Data>("/api/handover"), enabled: Boolean(snapshot), placeholderData: (p) => p });
  const [note, setNote] = useState("");
  const [source, setSource] = useState<"ai" | "rules" | "reczna">("reczna");

  const draft = useMutation({
    mutationFn: () => postJson<{ note: string; source: "ai" | "fallback" }>("/api/handover", { action: "draft" }),
    onSuccess: (r) => {
      setNote(r.note);
      setSource(r.source === "ai" ? "ai" : "rules");
      if (r.source !== "ai") toast.info("AI jest teraz niedostępne: notatka powstała z zestawienia po lewej.");
    },
    onError: (e) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: () => postJson("/api/handover", { action: "save", body: note, source }),
    onSuccess: () => {
      toast.success("Przekazanie zapisane. Następna zmiana zobaczy je na górze tej strony.");
      setNote("");
      setSource("reczna");
      void queryClient.invalidateQueries({ queryKey: ["handover"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const data = q.data;
  const last = data?.history[0];

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="handover-view">
      <div className="lg:col-span-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ClipboardCheck className="size-5 text-muted-foreground" aria-hidden /> Przekazanie zmiany
        </h1>
        <p className="text-sm text-muted-foreground">Co następny spedytor musi wiedzieć, zebrane z całego systemu. Notatkę zawsze czyta i zapisuje człowiek.</p>
      </div>

      {last && (
        <section className="rounded-lg border border-brand/40 bg-background p-3 lg:col-span-2" data-testid="handover-last">
          <h2 className="text-sm font-semibold">Ostatnie przekazanie: {formatSimClock(last.createdSim)}</h2>
          <p className="mb-1 text-[11px] text-muted-foreground">{SOURCE[last.source]}</p>
          <p className="whitespace-pre-wrap text-sm">{last.body}</p>
        </section>
      )}

      <section className="grid content-start gap-3">
        <h2 className="text-sm font-semibold">Stan na teraz{data ? `: ${data.at}` : ""}</h2>
        {!data && <p className="text-sm text-muted-foreground">Wczytywanie…</p>}
        {data && data.sections.length === 0 && <p className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">Spokojnie: brak alertów, zagrożonych zleceń i zaległych kolejek.</p>}
        {data?.sections.map((s) => (
          <div key={s.title} className={cn("rounded-lg border bg-background p-3", TONE[s.title])} data-testid={`handover-section-${s.title}`}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide">{s.title}</h3>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {s.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="grid content-start gap-2">
        <h2 className="text-sm font-semibold">Notatka dla następnej zmiany</h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => draft.mutate()} disabled={draft.isPending || !data} data-testid="handover-draft">
            <Sparkles /> {draft.isPending ? "Przygotowuję…" : "Przygotuj notatkę"}
          </Button>
          {note && source !== "reczna" && <span className="self-center text-xs text-muted-foreground">Szkic {SOURCE[source]}. Popraw go, zanim zapiszesz.</span>}
        </div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={14}
          maxLength={3000}
          aria-label="Notatka dla następnej zmiany"
          placeholder="Napisz sam albo kliknij „Przygotuj notatkę”: powstanie z zestawienia po lewej."
          className="text-sm"
          data-testid="handover-note"
        />
        <Button onClick={() => save.mutate()} disabled={save.isPending || note.trim().length < 10} className="justify-self-start" data-testid="handover-save">
          {save.isPending ? "Zapisuję…" : "Zapisz przekazanie"}
        </Button>
        {data && data.history.length > 1 && (
          <details className="mt-2 rounded-lg border bg-background p-3 text-sm">
            <summary className="cursor-pointer font-medium">Wcześniejsze przekazania ({data.history.length - 1})</summary>
            <ul className="mt-2 space-y-3">
              {data.history.slice(1).map((h) => (
                <li key={h.id}>
                  <div className="text-xs text-muted-foreground">
                    {formatSimClock(h.createdSim)} · {SOURCE[h.source]}
                  </div>
                  <p className="whitespace-pre-wrap">{h.body}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
