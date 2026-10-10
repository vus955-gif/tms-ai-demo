"use client";

import { Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { formatHm, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VehicleView } from "@/server/monitoring/views";
import { RISK_COLOR } from "./colors";

type Filter = "all" | "bus" | "tractor" | "risk";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Wszystkie" },
  { id: "bus", label: "Busy" },
  { id: "tractor", label: "Ciągniki" },
  { id: "risk", label: "Zagrożone" },
];
const RISK_ORDER: Record<VehicleView["risk"], number> = { red: 0, yellow: 1, green: 2, gray: 3 };

export function minutesAgo(iso: string | null, simNowMs: number): string {
  if (!iso) return "—";
  const m = Math.max(0, Math.round((simNowMs - new Date(iso).getTime()) / 60_000));
  return m === 0 ? "teraz" : `${m} min temu`;
}

export function VehicleList({
  vehicles,
  selectedId,
  onSelect,
  simNowMs,
}: {
  vehicles: VehicleView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  simNowMs: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = useMemo(() => {
    const list = vehicles.filter((v) =>
      filter === "all" ? true : filter === "risk" ? v.risk === "red" || v.risk === "yellow" : v.kind === filter,
    );
    return list.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.plates.localeCompare(b.plates));
  }, [vehicles, filter]);
  const atRisk = vehicles.filter((v) => v.risk === "red" || v.risk === "yellow").length;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap gap-1.5 border-b p-2.5" role="group" aria-label="Filtr pojazdów">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              filter === f.id ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {f.label}
            {f.id === "all" ? ` ${vehicles.length}` : f.id === "risk" && atRisk > 0 ? ` ${atRisk}` : ""}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_56px_72px] gap-2 border-b px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>Pojazd · trasa</span>
        <span className="text-right">Jazda</span>
        <span className="text-right">ETA</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="vehicle-list">
        {visible.map((v) => {
          const o = v.order;
          const late = o?.eta && new Date(o.eta) > new Date(o.deliveryTo);
          return (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onSelect(v.id)}
                aria-current={v.id === selectedId ? "true" : undefined}
                data-testid={`vehicle-row-${v.plates}`}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_56px_72px] items-start gap-2 border-b px-3 py-2 text-left transition-colors hover:bg-accent/60",
                  v.id === selectedId && "bg-accent",
                  v.risk === "red" && v.id !== selectedId && "bg-bad-soft/60",
                )}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: RISK_COLOR[v.risk] }} aria-label={`stan: ${v.risk}`} />
                    <span className="truncate">
                      {v.plates}
                      {v.trailerPlates ? <span className="text-muted-foreground"> + {v.trailerPlates}</span> : null}
                    </span>
                    {v.kind === "bus" && <Truck className="size-3 shrink-0 text-muted-foreground" aria-label="bus" />}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {v.driverName} · {o ? o.routeLabel : v.pointCity ? `wolny · ${v.pointCity}` : "wolny"}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="h-1 w-16 overflow-hidden rounded bg-muted">
                      <span className="block h-full bg-brand" style={{ width: `${Math.round((v.progress ?? (o?.arrivedDeliveryAt ? 1 : 0)) * 100)}%` }} />
                    </span>
                    <span>{v.modeLabel}</span>
                    <span>· {minutesAgo(v.lastReportAt, simNowMs)}</span>
                  </span>
                </span>
                <span className="text-right text-sm tabular-nums">
                  {v.drivingLeftMin === null ? <span className="text-xs text-muted-foreground" title="Bus w przewozie krajowym — przepisy 561/2006 nie mają zastosowania">nie dotyczy</span> : formatHm(v.drivingLeftMin)}
                </span>
                <span className={cn("text-right text-sm tabular-nums", late && "text-bad")}>
                  {o?.arrivedDeliveryAt ? (
                    <span className="text-xs text-muted-foreground">dostarczono {formatTime(o.arrivedDeliveryAt)}</span>
                  ) : o?.eta ? (
                    <>
                      {formatTime(o.eta)}
                      <span className="block text-[11px] text-muted-foreground">okno do {formatTime(o.deliveryTo)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Brak pojazdów w tym filtrze.</li>}
      </ul>
    </div>
  );
}
