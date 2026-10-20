"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, CheckCheck, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SNAPSHOT_KEY, useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatWarsaw } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FleetFileView, SubjectView, TermView } from "@/server/fleet/views";
import type { TermStatus } from "@/domain/fleet-terms";
import { SwapTrailerDialog } from "./swap-trailer-dialog";
import { groupThousands } from "@/domain/sales-pricing";

const STATUS: Record<TermStatus, { label: string; className: string }> = {
  po_terminie: { label: "po terminie", className: "border-bad/50 bg-bad-soft text-bad" },
  wkrotce: { label: "wkrótce", className: "border-warn/50 bg-warn-soft text-warn" },
  ok: { label: "w porządku", className: "border-transparent bg-muted text-muted-foreground" },
};

type Tab = "vehicles" | "trailers" | "drivers";
const TABS: { id: Tab; label: string }[] = [
  { id: "vehicles", label: "Pojazdy" },
  { id: "trailers", label: "Naczepy" },
  { id: "drivers", label: "Kierowcy" },
];

export function FleetView() {
  const { data: snapshot } = useSnapshot();
  const [tab, setTab] = useState<Tab>("vehicles");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const q = useQuery({ queryKey: ["fleet", snapshot?.simNow], queryFn: () => getJson<FleetFileView>("/api/fleet"), enabled: Boolean(snapshot), placeholderData: (p) => p });
  const data = q.data;
  const list = (data?.[tab] ?? []).filter((s) => !onlyAttention || s.worst !== "ok");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-5" data-testid="fleet-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Kartoteka floty</h1>
          <p className="text-sm text-muted-foreground">Przeglądy, ubezpieczenia, tachografy, serwisy i dokumenty kierowców. Termin blokujący po dacie wyklucza pojazd lub kierowcę z przydziału.</p>
        </div>
        {data && (
          <div className="flex gap-2 text-sm">
            <span className="rounded-md border border-bad/50 bg-bad-soft px-2 py-1 text-bad" data-testid="fleet-overdue">
              po terminie: <strong>{data.overdue}</strong>
            </span>
            <span className="rounded-md border border-warn/50 bg-warn-soft px-2 py-1 text-warn">
              w ciągu 30 dni / 5 000 km: <strong>{data.soon}</strong>
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Button key={t.id} size="sm" variant={tab === t.id ? "default" : "outline"} onClick={() => setTab(t.id)} data-testid={`fleet-tab-${t.id}`}>
            {t.label}
            {data && <span className="ml-1 text-xs opacity-70">{data[t.id].filter((s) => s.worst !== "ok").length || ""}</span>}
          </Button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="size-4" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} /> tylko wymagające uwagi
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((s) => (
          <SubjectCard key={s.id} subject={s} />
        ))}
      </div>
      {!data && <p className="text-sm text-muted-foreground">Wczytywanie…</p>}
    </div>
  );
}

function due(t: TermView) {
  if (t.kmLeft !== null) return t.kmLeft >= 0 ? `za ${groupThousands(t.kmLeft)} km` : `${groupThousands(-t.kmLeft)} km po terminie`;
  return t.dueSim ? formatWarsaw(t.dueSim, "d.MM.yyyy") : "—";
}

function SubjectCard({ subject }: { subject: SubjectView }) {
  const queryClient = useQueryClient();
  const [swapping, setSwapping] = useState(false);
  const renew = useMutation({
    mutationFn: (id: string) => postJson(`/api/fleet/terms/${encodeURIComponent(id)}`, { action: "renew" }),
    onSuccess: () => {
      toast.success("Odnotowano — nowy termin wyliczony.");
      void queryClient.invalidateQueries({ queryKey: ["fleet"] });
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <article className={cn("rounded-lg border bg-background p-3", subject.worst === "po_terminie" && "border-bad/60", subject.worst === "wkrotce" && "border-warn/60")} data-testid={`fleet-${subject.title}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <div className="font-semibold">{subject.title}</div>
          <div className="text-xs text-muted-foreground">{subject.subtitle}</div>
        </div>
        {subject.odometerKm !== null && <div className="text-xs tabular-nums text-muted-foreground">{groupThousands(subject.odometerKm)} km</div>}
      </div>
      {subject.coupling && <CouplingLine subject={subject} onSwap={() => setSwapping(true)} />}
      {swapping && <SwapTrailerDialog vehicleId={subject.id} onClose={() => setSwapping(false)} />}
      <ul className="space-y-1">
        {subject.terms.map((t) => (
          <li key={t.id} className={cn("flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs", STATUS[t.status].className)}>
            <span className="flex min-w-0 items-center gap-1">
              {t.blocking && <Lock className="size-3 shrink-0" aria-label="blokuje przydział po terminie" />}
              <span className="truncate">{t.label}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="tabular-nums">{due(t)}</span>
              {t.status !== "ok" && (
                <button type="button" title="Odnotuj wykonanie" onClick={() => renew.mutate(t.id)} disabled={renew.isPending} className="rounded p-0.5 hover:bg-background/60" data-testid={`renew-${t.id}`}>
                  <CheckCheck className="size-3.5" aria-label="Odnotuj wykonanie" />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** Which trailer is under the tractor (or where the trailer stands), with the recent history of swaps. */
function CouplingLine({ subject, onSwap }: { subject: SubjectView; onSwap: () => void }) {
  const c = subject.coupling!;
  const when = (iso: string) => formatWarsaw(iso, "d.MM HH:mm");
  return (
    <div className="mb-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs" data-testid={`coupling-${subject.title}`}>
      <div className="flex items-center justify-between gap-2">
        <span>
          <strong>{c.now}</strong>
          {c.since && <span className="text-muted-foreground"> · od {when(c.since)}</span>}
        </span>
        {c.canSwap && (
          <Button size="xs" variant="outline" onClick={onSwap} data-testid={`swap-${subject.title}`}>
            <ArrowLeftRight /> Przepnij
          </Button>
        )}
      </div>
      {c.history.length > 1 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground">Historia przepięć</summary>
          <ul className="mt-1 space-y-0.5">
            {c.history.map((h) => (
              <li key={`${h.from}${h.vehiclePlates}${h.trailerPlates}`} className="tabular-nums">
                {subject.type === "trailer" ? h.vehiclePlates : h.trailerPlates}: {when(h.from)} – {h.to ? when(h.to) : "teraz"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
