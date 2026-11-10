"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROFILE_PRESETS, profileLabel } from "@/domain/offer-ranking";
import { postJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { QuoteDetailView } from "@/server/sales/views";

/**
 * The client's quoting profile and the ranking it produces. The salesperson sets how much price
 * matters to this client against transit time; the fit percentages in the table follow from that
 * by arithmetic. "Wyjaśnij ranking" asks AI to put the result into words — it cannot reorder it.
 */
export function RankingPanel({ quote, editable }: { quote: QuoteDetailView; editable: boolean }) {
  const queryClient = useQueryClient();
  const url = `/api/sales/${quote.id}`;
  const [weight, setWeight] = useState(quote.profile.priceWeight);
  const [note, setNote] = useState(quote.profile.note);
  const [explanation, setExplanation] = useState<{ text: string; source: "ai" | "fallback"; forWeight: number } | null>(null);
  const dirty = weight !== quote.profile.priceWeight || note.trim() !== quote.profile.note;

  const save = useMutation({
    mutationFn: () => postJson(url, { action: "profile", priceWeight: weight, note }),
    onSuccess: () => {
      toast.success(`Profil klienta zapisany: ${profileLabel(weight)}. Dotyczy też kolejnych wycen dla ${quote.client.name}.`);
      setExplanation(null);
      void queryClient.invalidateQueries({ queryKey: ["sales-quote"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const explain = useMutation({
    mutationFn: () => postJson<{ text: string; source: "ai" | "fallback" }>(url, { action: "explain" }),
    onSuccess: (r) => setExplanation({ ...r, forWeight: quote.profile.priceWeight }),
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="mb-3 grid gap-2 rounded-md border bg-muted/30 p-2.5 text-sm" data-testid="ranking-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold">Profil klienta do wycen:</span>
        <span className="text-xs text-muted-foreground" data-testid="profile-label">
          {profileLabel(weight)}
        </span>
        <div className="ml-auto flex gap-1" role="group" aria-label="Gotowe profile">
          {PROFILE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!editable}
              onClick={() => setWeight(p.priceWeight)}
              aria-pressed={weight === p.priceWeight}
              className={cn("rounded-full border px-2 py-0.5 text-xs", weight === p.priceWeight ? "border-brand bg-background font-medium" : "text-muted-foreground hover:bg-background")}
              data-testid={`profile-${p.id}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <label className="grid gap-1 text-xs">
        <span className="flex justify-between text-muted-foreground">
          <span>czas: {100 - weight}%</span>
          <span>cena: {weight}%</span>
        </span>
        <input type="range" min={0} max={100} step={5} value={weight} disabled={!editable} onChange={(e) => setWeight(Number(e.target.value))} aria-label="Waga ceny względem czasu tranzytu" className="w-full" />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 flex-1 gap-1 text-xs">
          <span className="text-muted-foreground">Co wiemy o tym kliencie (notatka dla handlowca i dla AI)</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} disabled={!editable} placeholder="np. lubi tanio i dłużej; albo: wszystko na już, cena drugorzędna" className="h-8" />
        </label>
        <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={!dirty || !editable || save.isPending} data-testid="profile-save">
          Zapisz profil
        </Button>
        <Button size="sm" variant="outline" onClick={() => explain.mutate()} disabled={quote.ranking.length === 0 || dirty || explain.isPending} data-testid="ranking-explain">
          <Sparkles /> {explain.isPending ? "Piszę…" : "Wyjaśnij ranking"}
        </Button>
      </div>
      {quote.rankingNote && <p className="text-xs text-warn">{quote.rankingNote}</p>}
      {explanation && explanation.forWeight === quote.profile.priceWeight && (
        <p className="rounded-md bg-ai-soft/60 p-2 text-xs" data-testid="ranking-explanation">
          <span className="font-medium text-ai">{explanation.source === "ai" ? "Uzasadnienie AI: " : "Uzasadnienie (bez AI): "}</span>
          {explanation.text} <span className="text-muted-foreground">Kolejność ofert liczy algorytm; decyzja należy do handlowca.</span>
        </p>
      )}
    </div>
  );
}
