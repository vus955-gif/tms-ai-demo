"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getJson } from "@/lib/api";
import { formatWarsaw } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClosedOrder } from "@/server/orders/closed";

const CLOSED_KEY = ["orders-closed"] as const;

/** Asks the server for the CSV, marks the orders as exported there, and hands the file to the browser. */
async function downloadExport(orderIds: string[]): Promise<number> {
  const res = await fetch("/api/orders/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderIds }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Błąd serwera (${res.status})`);
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "zlecenia-do-faktur.csv";
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return Number(res.headers.get("x-exported-count") ?? orderIds.length);
}

/**
 * "Zamknięte zlecenia": finished runs waiting for an invoice. The export marks what went out,
 * so the next export proposes only the new ones and nothing is invoiced twice.
 */
export function ClosedOrdersDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: CLOSED_KEY, queryFn: () => getJson<{ orders: ClosedOrder[] }>("/api/orders/closed") });
  // Until the dispatcher touches a checkbox, the selection is "everything not exported yet".
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const list = q.data?.orders ?? [];
  const pending = list.filter((o) => !o.exportedAt);
  const selected = picked ?? new Set(pending.map((o) => o.id));
  const chosen = list.filter((o) => selected.has(o.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const run = useMutation({
    mutationFn: () => downloadExport(chosen.map((o) => o.id)),
    onSuccess: (count) => {
      toast.success(`Pobrano plik CSV: ${count} ${count === 1 ? "zlecenie" : count < 5 ? "zlecenia" : "zleceń"}. Oznaczone jako wyeksportowane.`);
      setPicked(null);
      void queryClient.invalidateQueries({ queryKey: CLOSED_KEY });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-4xl" data-testid="closed-orders">
        <DialogHeader>
          <DialogTitle>Zamknięte zlecenia</DialogTitle>
          <DialogDescription>
            Zakończone kursy z danymi do faktury. Plik CSV otwiera się w Excelu; wyeksportowane zlecenia system oznacza, żeby nie trafiły do faktur drugi raz.
          </DialogDescription>
        </DialogHeader>
        {q.isPending ? (
          <p className="text-sm text-muted-foreground">Wczytywanie…</p>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {q.error.message}
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nie ma jeszcze zamkniętych zleceń. Zlecenie zamyka się w Dokumentach, po sprawdzeniu CMR.</p>
        ) : (
          <div className="min-h-0 overflow-auto rounded-md border">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="sticky top-0 bg-muted text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-1.5">
                    <span className="sr-only">Wybór</span>
                  </th>
                  <th className="px-2 py-1.5 font-medium">Zlecenie</th>
                  <th className="px-2 py-1.5 font-medium">Klient</th>
                  <th className="px-2 py-1.5 font-medium">Trasa</th>
                  <th className="px-2 py-1.5 text-right font-medium">km</th>
                  <th className="px-2 py-1.5 font-medium">Rozładunek</th>
                  <th className="px-2 py-1.5 font-medium">CMR</th>
                  <th className="px-2 py-1.5 font-medium">Eksport</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((o) => (
                  <tr key={o.id} data-testid={`closed-${o.number}`} className={cn(o.exportedAt && "text-muted-foreground")}>
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Wybierz ${o.number} do eksportu`} />
                    </td>
                    <td className="px-2 py-1.5 font-medium tabular-nums">{o.number}</td>
                    <td className="px-2 py-1.5">{o.clientName}</td>
                    <td className="px-2 py-1.5">
                      {o.pickupCity} → {o.deliveryCity}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums" title={o.distanceApprox ? "Dystans szacowany (punkt dodany w aplikacji)" : undefined}>
                      {o.distanceKm === null ? "—" : `${o.distanceApprox ? "≈ " : ""}${o.distanceKm}`}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{formatWarsaw(o.unloadedAt, "d.MM HH:mm")}</td>
                    <td className="px-2 py-1.5">{o.cmrOnFile ? "skan jest" : "brak skanu"}</td>
                    <td className="px-2 py-1.5">{o.exportedAt ? `wyeksportowane ${formatWarsaw(o.exportedAt, "d.MM HH:mm")}` : <span className="font-medium text-foreground">do faktury</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground" data-testid="closed-summary">
            Do faktury: {pending.length}. Zaznaczone: {chosen.length}. Kwoty nie są częścią zlecenia w tym demo, więc w pliku ich nie ma.
          </p>
          <Button onClick={() => run.mutate()} disabled={chosen.length === 0 || run.isPending} data-testid="export-csv">
            <Download /> {run.isPending ? "Przygotowuję plik…" : `Pobierz CSV (${chosen.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
