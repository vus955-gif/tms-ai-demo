"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SNAPSHOT_KEY, useSnapshot, type ClientSnapshot } from "@/hooks/use-snapshot";
import { postJson } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AlertAction } from "@/db/schema";
import type { AlertView } from "@/server/monitoring/views";
import type { Snapshot } from "@/server/snapshot";

const ACTION_LABEL: Record<AlertAction, string> = {
  pokaz_objazd: "Pokaż objazd",
  zastosuj_objazd: "Zastosuj objazd",
  powiadom_klienta: "Powiadom klienta",
  napisz_do_kierowcy: "Napisz do kierowcy",
  przydziel_innego: "Przydziel innego",
  otworz_dokument: "Otwórz dokument",
  brak: "",
};

const SEVERITY_STYLE: Record<AlertView["severity"], string> = {
  critical: "border-l-bad",
  warning: "border-l-warn",
  info: "border-l-muted-foreground/40",
};

/** Number of alerts that need attention (critical + warning). */
export function urgentCount(alerts: AlertView[] | undefined): number {
  return (alerts ?? []).filter((a) => a.status === "open" && a.severity !== "info").length;
}

export function AlertsButton() {
  const [open, setOpen] = useState(false);
  const { data: snapshot } = useSnapshot();
  const count = urgentCount(snapshot?.alerts);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Powiadomienia (${count})`}
        aria-expanded={open}
        data-testid="alerts-toggle"
        className="relative"
      >
        <Bell />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-bad px-1 text-[10px] font-semibold leading-4 text-white">{count}</span>
        )}
      </Button>
      {open && <AlertsPanel alerts={snapshot?.alerts ?? []} onClose={() => setOpen(false)} />}
    </>
  );
}

function AlertsPanel({ alerts, onClose }: { alerts: AlertView[]; onClose: () => void }) {
  return (
    <div className="absolute right-2 top-12 z-50 flex max-h-[calc(100dvh-4rem)] w-[400px] flex-col rounded-lg border bg-background shadow-xl" data-testid="alerts-panel">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">Powiadomienia</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Zamknij powiadomienia">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {alerts.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Brak otwartych powiadomień. Flota jedzie zgodnie z planem.</p>
        ) : (
          alerts.map((a) => <AlertCard key={a.id} alert={a} onNavigate={onClose} />)
        )}
      </div>
    </div>
  );
}

export function AlertCard({ alert, onNavigate }: { alert: AlertView; onNavigate?: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const refresh = (snapshot?: Snapshot) => {
    if (snapshot) queryClient.setQueryData<ClientSnapshot>(SNAPSHOT_KEY, { ...snapshot, fetchedAt: Date.now() });
    void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
  };
  const close = useMutation({
    mutationFn: () => postJson(`/api/alerts/${alert.id}`, { action: "resolve" }),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(e.message),
  });
  const reroute = useMutation({
    mutationFn: () => postJson<Snapshot>(`/api/vehicles/${alert.vehicleId}/reroute`, { routeKey: alert.alternativeRouteKey }),
    onSuccess: (s) => {
      refresh(s);
      toast.success("Objazd zastosowany");
    },
    onError: (e) => toast.error(e.message),
  });

  const run = (action: AlertAction) => {
    switch (action) {
      case "pokaz_objazd":
        router.push(`/monitoring?v=${alert.vehicleId}&alt=1`);
        onNavigate?.();
        break;
      case "zastosuj_objazd":
        reroute.mutate();
        break;
      case "napisz_do_kierowcy":
        router.push(`/komunikator${alert.vehicleId ? `?v=${alert.vehicleId}` : ""}`);
        onNavigate?.();
        break;
      case "przydziel_innego":
        router.push("/zlecenia");
        onNavigate?.();
        break;
      case "otworz_dokument":
        router.push(`/dokumenty?doc=${alert.documentId}`);
        onNavigate?.();
        break;
      case "powiadom_klienta":
        router.push(`/skrzynka${alert.orderId ? `?order=${alert.orderId}` : ""}`);
        onNavigate?.();
        break;
      default:
        break;
    }
  };

  const actions = alert.actions.filter(
    (a) => a !== "brak" && (a !== "zastosuj_objazd" || alert.alternativeRouteKey) && (a !== "otworz_dokument" || alert.documentId),
  );
  return (
    <article className={cn("rounded-md border border-l-4 bg-background p-3", SEVERITY_STYLE[alert.severity])} data-testid="alert-card">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium leading-snug">{alert.title}</h3>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatTime(alert.createdSim)}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{alert.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {actions.map((a) => (
          <Button key={a} size="xs" variant="outline" onClick={() => run(a)} disabled={reroute.isPending}>
            {ACTION_LABEL[a]}
          </Button>
        ))}
        {alert.vehicleId && !actions.includes("pokaz_objazd") && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              router.push(`/monitoring?v=${alert.vehicleId}`);
              onNavigate?.();
            }}
          >
            Pokaż na mapie
          </Button>
        )}
        <Button size="xs" variant="ghost" onClick={() => close.mutate()} disabled={close.isPending} className="ml-auto">
          Zamknij
        </Button>
      </div>
      {alert.bodySource === "ai" && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ai">
          <Sparkles className="size-3" aria-hidden /> wyjaśnienie AI
        </p>
      )}
    </article>
  );
}
