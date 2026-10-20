"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Route, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SNAPSHOT_KEY, type ClientSnapshot } from "@/hooks/use-snapshot";
import { postJson } from "@/lib/api";
import { formatHm, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Snapshot } from "@/server/snapshot";
import type { VehicleDetail } from "@/server/monitoring/vehicle-detail";
import type { VehicleView } from "@/server/monitoring/views";
import { ClientLinkBox } from "@/components/tracking/client-link-box";
import { RISK_COLOR } from "./colors";

const RISK_LABEL: Record<VehicleView["risk"], string> = { green: "zdąży", yellow: "uwaga", red: "zagrożone", gray: "bez zlecenia w drodze" };
const ACTIVITY_LABEL: Record<string, string> = { driving: "jazda", break: "przerwa", daily_rest: "odpoczynek", other_work: "inna praca" };

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "bad" | "warn" }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right tabular-nums", tone === "bad" && "text-bad", tone === "warn" && "text-warn")}>{value}</span>
    </div>
  );
}

export function VehicleDetailPanel({
  vehicle,
  detail,
  showAlternative,
  onToggleAlternative,
  onClose,
}: {
  vehicle: VehicleView;
  detail: VehicleDetail | undefined;
  showAlternative: boolean;
  onToggleAlternative: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const reroute = useMutation({
    mutationFn: (routeKey: string) => postJson<Snapshot>(`/api/vehicles/${vehicle.id}/reroute`, { routeKey }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData<ClientSnapshot>(SNAPSHOT_KEY, { ...snapshot, fetchedAt: Date.now() });
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicle.id] });
      toast.success(`${vehicle.plates} jedzie objazdem`);
    },
    onError: (e) => toast.error(e.message),
  });
  const o = vehicle.order;
  const b = detail?.breakdown;

  return (
    <div className="flex min-h-0 flex-col" data-testid="vehicle-detail">
      <div className="flex items-start justify-between gap-2 border-b p-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <span className="size-2.5 rounded-full" style={{ background: RISK_COLOR[vehicle.risk] }} />
            {vehicle.plates}
            {vehicle.trailerPlates && <span className="font-normal text-muted-foreground">+ {vehicle.trailerPlates}</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {vehicle.driverName} · {vehicle.kind === "bus" ? "bus" : "ciągnik siodłowy"} · {RISK_LABEL[vehicle.risk]}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Zamknij szczegóły">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {o ? (
          <section>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Zlecenie</h3>
            <Row label="Numer" value={`${o.number} · ${o.statusLabel}`} />
            <Row label="Klient" value={o.clientName} />
            <Row label="Trasa" value={o.routeLabel} />
            <Row label="Okno załadunku" value={`${formatTime(o.pickupFrom)}–${formatTime(o.pickupTo)}`} />
            <Row label="Okno rozładunku" value={`${formatTime(o.deliveryFrom)}–${formatTime(o.deliveryTo)}`} />
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">Pojazd nie ma teraz zlecenia{vehicle.pointCity ? ` — stoi w: ${vehicle.pointCity}` : ""}.</p>
        )}

        {o && <ClientLinkBox key={o.id} orderId={o.id} />}

        {b && (
          <section>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Prognoza dojazdu</h3>
            <Row label="ETA rozładunek" value={formatTime(b.eta)} tone={o && new Date(b.eta) > new Date(o.deliveryTo) ? "bad" : undefined} />
            <Row label="Jazda" value={formatHm(b.drivingMin)} />
            <Row label="Przerwy po drodze" value={b.breaks > 0 ? `${b.breaks} × 45 min` : "brak"} tone={b.firstBreakAfterDrivingMin !== null && b.firstBreakAfterDrivingMin <= 60 ? "warn" : undefined} />
            {b.restRequired && <Row label="Odpoczynek dobowy" value={formatHm(b.restMin)} tone="bad" />}
            {b.otherWorkMin > 0 && <Row label="Załadunek, oczekiwanie" value={formatHm(b.otherWorkMin)} />}
            {detail?.route?.approximate && (
              <p className="mt-1 text-[11px] text-warn" data-testid="approximate-route">
                Trasa przybliżona: punkt dodany w aplikacji nie ma jeszcze trasy drogowej — na mapie linia prosta, km i czas szacowane.
              </p>
            )}
          </section>
        )}

        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Czas pracy kierowcy</h3>
          <Row label="Teraz" value={vehicle.modeUntil ? `${vehicle.modeLabel} do ${formatTime(vehicle.modeUntil)}` : vehicle.modeLabel} />
          {vehicle.subjectTo561 ? (
            <>
              <Row label="Jazda ciągła" value={`${formatHm(vehicle.continuousMin)} / 4:30`} tone={vehicle.continuousMin >= 210 ? "warn" : undefined} />
              <Row label="Jazda dziś" value={`${formatHm(vehicle.dailyMin)} / ${formatHm(vehicle.dailyLimitMin ?? 540)}`} />
              <Row label="Do przerwy" value={formatHm(vehicle.untilBreakMin ?? 0)} />
            </>
          ) : (
            <p className="py-1 text-sm text-muted-foreground">Bus w przewozie krajowym — limity rozporządzenia 561/2006 nie mają zastosowania.</p>
          )}
        </section>

        {detail && detail.alternatives.length > 0 && (
          <section className="rounded-lg border border-ai/30 bg-ai-soft/40 p-3">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <Route className="size-4 text-ai" aria-hidden /> Objazd dostępny
            </h3>
            {detail.alternatives.map((alt) => (
              <div key={alt.key} className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {alt.label}. ETA objazdem: <strong className="text-foreground">{alt.eta ? formatTime(alt.eta) : "?"}</strong>
                  {b ? ` (obecnie ${formatTime(b.eta)})` : ""}.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={onToggleAlternative} data-testid="toggle-alternative">
                    {showAlternative ? "Ukryj objazd" : "Pokaż objazd"}
                  </Button>
                  <Button size="sm" onClick={() => reroute.mutate(alt.key)} disabled={reroute.isPending} data-testid="apply-alternative">
                    Zastosuj objazd
                  </Button>
                </div>
              </div>
            ))}
          </section>
        )}
        {vehicle.rerouted && <p className="text-sm text-ai">Pojazd jedzie objazdem.</p>}

        {detail && detail.activities.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Ostatnie aktywności</h3>
            <ul className="space-y-0.5 text-sm">
              {detail.activities.slice(0, 8).map((a) => (
                <li key={a.start} className="flex justify-between gap-2">
                  <span>{ACTIVITY_LABEL[a.type] ?? a.type}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatTime(a.start)}–{a.end ? formatTime(a.end) : "teraz"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
