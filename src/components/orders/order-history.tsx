"use client";

import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { durationLabel, type HistoryEntry, type HistoryKind } from "@/domain/order-history";
import { getJson } from "@/lib/api";
import { formatSimClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OrderHistoryView } from "@/server/orders/history";

const DOT: Record<HistoryKind, string> = {
  start: "bg-muted-foreground",
  forward: "bg-ok",
  back: "bg-warn",
  closed: "bg-foreground",
  cancelled: "bg-bad",
};

const ACTOR_TONE: Record<HistoryEntry["actor"], string> = {
  dispatcher: "bg-muted text-foreground",
  driver: "bg-ok-soft text-ok",
  ai: "bg-ai-soft text-ai",
  system: "bg-muted text-muted-foreground",
};

/** Small clock icon next to an order number; opens the order's history. Safe inside a draggable card (the drag handle is separate). */
export function OrderHistoryButton({ orderId, number, className }: { orderId: string; number: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Historia zlecenia ${number}`}
        aria-label={`Historia zlecenia ${number}`}
        data-testid={`history-${number}`}
        className={cn("rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", className)}
      >
        <History className="size-3.5" aria-hidden />
      </button>
      {open && <OrderHistoryDialog orderId={orderId} number={number} onClose={() => setOpen(false)} />}
    </>
  );
}

function OrderHistoryDialog({ orderId, number, onClose }: { orderId: string; number: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["order-history", orderId],
    queryFn: () => getJson<OrderHistoryView>(`/api/orders/${orderId}/history`),
    // Opened to see what just happened: never show a cached list from an earlier look.
    staleTime: 0,
    gcTime: 0,
  });
  const h = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg" data-testid="order-history">
        <DialogHeader>
          <DialogTitle>Historia zlecenia {number}</DialogTitle>
          <DialogDescription>
            {h ? `${h.clientName} · ${h.routeLabel} · ${h.statusLabel}${h.driverName ? ` · ${h.driverName}` : ""}` : "Każda zmiana statusu: kiedy, kto i dlaczego."}
          </DialogDescription>
        </DialogHeader>
        {q.isPending ? (
          <p className="text-sm text-muted-foreground">Wczytywanie…</p>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {q.error.message}
          </p>
        ) : (
          <>
            <ol className="min-h-0 overflow-y-auto pr-1" data-testid="order-history-list">
              {h!.entries.map((e, i) => (
                <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < h!.entries.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-border" aria-hidden />}
                  <span className={cn("relative mt-1.5 size-[11px] shrink-0 rounded-full ring-2 ring-background", DOT[e.kind])} aria-hidden />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium">{e.from ? `${e.from} → ${e.to}` : `Start: ${e.to}`}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", ACTOR_TONE[e.actor])}>{e.actorLabel}</span>
                      {e.kind === "back" && <span className="text-[11px] font-medium text-warn">krok wstecz</span>}
                    </div>
                    {e.reason && <div className="text-xs text-muted-foreground">{e.reason}</div>}
                    <div className="text-[11px] tabular-nums text-muted-foreground">
                      {formatSimClock(e.at)}
                      {e.sincePrevMin !== null && e.sincePrevMin > 0 ? ` · po ${durationLabel(e.sincePrevMin)}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <p className="border-t pt-2 text-xs text-muted-foreground" data-testid="order-history-summary">
              Zmian: {h!.entries.length}
              {h!.summary.totalMin !== null ? ` · od pierwszej do ostatniej: ${durationLabel(h!.summary.totalMin)}` : ""}
              {h!.summary.stepsBack > 0 ? ` · kroków wstecz: ${h!.summary.stepsBack}` : ""}. Godziny według zegara demo.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
