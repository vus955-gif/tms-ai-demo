"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSnapshot } from "@/hooks/use-snapshot";
import { getJson } from "@/lib/api";
import { formatSimClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ShipmentFormOptions, ShipmentListItem } from "@/server/shipments/views";
import { CLIENT_STATE, delayText, MODE, STATUS } from "./labels";
import { NewShipmentDialog } from "./new-shipment-dialog";
import { ShipmentDetailView } from "./shipment-detail";

export function ShipmentsView() {
  const { data: snapshot } = useSnapshot();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromQuote = params.get("fromQuote");
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["shipments", snapshot?.simNow],
    queryFn: () => getJson<{ shipments: ShipmentListItem[]; options: ShipmentFormOptions }>("/api/shipments"),
    enabled: Boolean(snapshot),
    placeholderData: (prev) => prev,
  });
  const items = list.data?.shipments ?? [];
  const selected = params.get("s") ?? items[0]?.id ?? null;
  // The list re-sorts as deadlines come and go: pin the first pick in the URL so the open
  // shipment (and a draft being edited) does not switch under the forwarder's hands.
  const firstId = items[0]?.id;
  useEffect(() => {
    if (!params.get("s") && !params.get("fromQuote") && firstId) router.replace(`${pathname}?s=${firstId}`, { scroll: false });
  }, [params, firstId, router, pathname]);
  const open = (id: string) => router.replace(`${pathname}?s=${id}`, { scroll: false });

  return (
    <div className="grid h-full min-h-0 grid-cols-[340px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h1 className="text-sm font-semibold">Przesyłki morskie, lotnicze i kolejowe</h1>
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)} disabled={!list.data} data-testid="new-shipment">
            <Plus /> Nowa
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="shipment-list">
          {items.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => open(s.id)}
                aria-current={s.id === selected ? "true" : undefined}
                data-testid={`shipment-${s.number}`}
                className={cn("w-full border-b px-3 py-2 text-left hover:bg-accent/60", s.id === selected && "bg-accent")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    <span aria-hidden>{MODE[s.mode].icon}</span> {s.number}
                  </span>
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS[s.status].className)}>{STATUS[s.status].label}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{s.clientName}</div>
                <div className="truncate text-xs">
                  {s.origin} → {s.destination}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                  {s.status !== "anulowana" && (
                    <span className="text-muted-foreground">
                      {s.status === "dostarczona" ? "dotarła" : "ETA"} {formatSimClock(s.etaCurrent)}
                    </span>
                  )}
                  {s.status !== "anulowana" && delayText(s.delayHours) && (
                    <span className={cn("rounded px-1 py-0.5 font-medium", s.delayHours > 0 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>{delayText(s.delayHours)}</span>
                  )}
                  {s.etaNews && <span className="rounded bg-warn-soft px-1 py-0.5 font-medium text-warn">nowe ETA</span>}
                  {s.clientUpdate.state !== "ok" && <span className={cn("rounded px-1 py-0.5 font-medium", CLIENT_STATE[s.clientUpdate.state].className)}>{CLIENT_STATE[s.clientUpdate.state].label}</span>}
                  {s.clientUpdate.auto && s.status !== "anulowana" && s.status !== "dostarczona" && <span className="text-ai">statusy automatycznie</span>}
                  {s.agent.awaiting && <span className="text-muted-foreground">{s.agent.reminded ? "przypomniano agentowi" : "czeka na agenta"}</span>}
                </div>
              </button>
            </li>
          ))}
          {list.data && items.length === 0 && <li className="p-4 text-sm text-muted-foreground">Brak przesyłek. Utwórz pierwszą przyciskiem „Nowa” albo z wygranej wyceny w Sprzedaży.</li>}
        </ul>
      </aside>
      {selected ? <ShipmentDetailView key={selected} id={selected} /> : <div className="flex items-center justify-center text-sm text-muted-foreground">Wybierz przesyłkę z listy.</div>}
      {list.data && (creating || fromQuote) && (
        <NewShipmentDialog
          options={list.data.options}
          fromQuote={fromQuote}
          onClose={() => {
            setCreating(false);
            if (fromQuote) router.replace(pathname, { scroll: false });
          }}
          onCreated={(id) => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ["shipments"] });
            open(id);
          }}
        />
      )}
    </div>
  );
}
