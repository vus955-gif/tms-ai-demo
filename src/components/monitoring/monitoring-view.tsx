"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { useNow } from "@/hooks/use-now";
import { interpolatedSimNow, useSnapshot } from "@/hooks/use-snapshot";
import { getJson } from "@/lib/api";
import type { VehicleDetail } from "@/server/monitoring/vehicle-detail";
import { VehicleDetailPanel } from "./vehicle-detail-panel";
import { VehicleList } from "./vehicle-list";

const FleetMap = dynamic(() => import("./fleet-map").then((m) => m.FleetMap), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Ładowanie mapy…</div>,
});

export function MonitoringView() {
  const { data: snapshot, isPending } = useSnapshot();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const now = useNow();
  const selectedId = params.get("v");
  const showAlternative = params.get("alt") === "1";

  const setParams = useCallback(
    (next: { v?: string | null; alt?: boolean }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.v !== undefined) {
        if (next.v) sp.set("v", next.v);
        else sp.delete("v");
      }
      if (next.alt !== undefined) {
        if (next.alt) sp.set("alt", "1");
        else sp.delete("alt");
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const detail = useQuery({
    queryKey: ["vehicle", selectedId, snapshot?.simNow],
    queryFn: () => getJson<VehicleDetail>(`/api/vehicles/${selectedId}`),
    enabled: Boolean(selectedId && snapshot),
    placeholderData: keepPreviousData,
  });

  const vehicles = snapshot?.fleet ?? [];
  const selected = vehicles.find((v) => v.id === selectedId) ?? null;
  const simNowMs = snapshot ? (now !== null ? interpolatedSimNow(snapshot, now) : new Date(snapshot.simNow).getTime()) : 0;
  const detailData = detail.data && detail.data.vehicle.id === selectedId ? detail.data : undefined;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_420px]">
      <div className="relative min-h-0">
        <FleetMap
          vehicles={vehicles}
          selectedId={selectedId}
          detail={detailData}
          showAlternative={showAlternative}
          onSelect={(id) => setParams({ v: id, alt: false })}
        />
        <div className="pointer-events-none absolute left-3 top-[84px] flex flex-col gap-1 rounded-md bg-background/90 px-2.5 py-2 text-xs shadow-sm">
          <Legend color="#16a34a" label="zdąży" />
          <Legend color="#d97706" label="uwaga" />
          <Legend color="#dc2626" label="zagrożone" />
          <Legend color="#94a3b8" label="wolny" />
        </div>
      </div>
      <aside className="flex min-h-0 flex-col border-l bg-background">
        {isPending && vehicles.length === 0 && <p className="p-6 text-sm text-muted-foreground">Wczytywanie floty…</p>}
        {selected ? (
          <VehicleDetailPanel
            vehicle={selected}
            detail={detailData}
            showAlternative={showAlternative}
            onToggleAlternative={() => setParams({ alt: !showAlternative })}
            onClose={() => setParams({ v: null, alt: false })}
          />
        ) : (
          <VehicleList vehicles={vehicles} selectedId={selectedId} onSelect={(id) => setParams({ v: id, alt: false })} simNowMs={simNowMs} />
        )}
      </aside>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
