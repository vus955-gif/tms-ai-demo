"use client";

import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import dynamic from "next/dynamic";
import { ApiError, getJson } from "@/lib/api";
import { formatSimClock, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PublicTracking } from "@/server/tracking/links";

const TrackingMap = dynamic(() => import("./tracking-map").then((m) => m.TrackingMap), { ssr: false, loading: () => <div className="h-72 rounded-xl border bg-muted" /> });

const STATE_TEXT: Record<PublicTracking["state"], string> = {
  przed: "Śledzenie jeszcze nieaktywne",
  aktywny: "Śledzenie aktywne",
  zakonczony: "Śledzenie zakończone",
  wylaczony: "Link wyłączony przez przewoźnika",
};

/** Public page for the client: one transport, client-safe facts only. */
export function TrackingView({ token }: { token: string }) {
  const q = useQuery({
    queryKey: ["track", token],
    queryFn: () => getJson<PublicTracking>(`/api/track/${encodeURIComponent(token)}`),
    refetchInterval: 30_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const t = q.data;
  const v = t?.view;

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-4 bg-background p-4 sm:p-6">
      <header className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-md bg-brand text-brand-foreground">
          <Truck className="size-4" aria-hidden />
        </span>
        <div>
          <div className="font-semibold">{t?.carrier ?? "Śledzenie przesyłki"}</div>
          <div className="text-xs text-muted-foreground">Śledzenie przesyłki{t?.clientName ? ` · ${t.clientName}` : ""}</div>
        </div>
      </header>

      {q.isError && (
        <p className="rounded-lg border p-4 text-sm" role="alert">
          {q.error.message}
        </p>
      )}
      {!t && !q.isError && <p className="text-sm text-muted-foreground">Wczytywanie…</p>}

      {t && (
        <>
          <section className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2" data-testid="tracking-card">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Zlecenie</div>
              <div className="text-lg font-semibold">{v?.number ?? "—"}</div>
              {v && v.references.length > 0 && <div className="text-sm text-muted-foreground">ref. {v.references.join(", ")}</div>}
              {v && (
                <div className="mt-1 text-sm">
                  {v.pickupCity} → {v.deliveryCity}
                </div>
              )}
            </div>
            <div className="space-y-1 text-sm">
              <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-medium", t.state === "aktywny" ? "bg-ok-soft text-ok" : "bg-muted text-muted-foreground")} data-testid="tracking-state">
                {STATE_TEXT[t.state]}
              </span>
              {v && <div>Status: <strong>{v.status}</strong></div>}
              {v?.plates && <div>Pojazd: {[v.plates, v.trailerPlates].filter(Boolean).join(" / ")}</div>}
              {v?.eta && t.state === "aktywny" && <div>Przewidywany przyjazd: <strong>{formatSimClock(v.eta)}</strong></div>}
              {v && <div className="text-muted-foreground">Okno rozładunku: {formatSimClock(v.deliveryWindow.from)}–{formatTime(v.deliveryWindow.to)}</div>}
            </div>
            {v?.progressPct !== null && v?.progressPct !== undefined && t.state === "aktywny" && (
              <div className="sm:col-span-2">
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>Postęp trasy</span>
                  <span>{v.progressPct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-brand" style={{ width: `${v.progressPct}%` }} />
                </div>
              </div>
            )}
          </section>

          {t.state === "aktywny" ? (
            <>
              <TrackingMap position={t.position} route={t.route} />
              {t.approximateRoute && <p className="text-xs text-muted-foreground">Przebieg trasy na mapie jest orientacyjny; pozycja i przewidywany przyjazd są aktualne.</p>}
            </>
          ) : (
            <p className="rounded-xl border p-4 text-sm text-muted-foreground">
              {t.state === "przed" && <>Śledzenie ruszy {formatSimClock(t.window.from)} — wtedy zobaczysz pozycję auta i przewidywany przyjazd.</>}
              {t.state === "zakonczony" && <>Śledzenie zakończyło się {formatSimClock(t.window.to)}. W razie pytań skontaktuj się z przewoźnikiem.</>}
              {t.state === "wylaczony" && <>Przewoźnik wyłączył ten link.</>}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Widoczne od {formatSimClock(t.window.from)} do {formatSimClock(t.window.to)} · pozycja z ostatniego raportu GPS
            {t.position ? ` (${formatTime(t.position.at)})` : ""} · dane demo, fikcyjne.
          </p>
        </>
      )}
    </div>
  );
}
