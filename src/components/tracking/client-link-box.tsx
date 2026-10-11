"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Link2, Timer, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatSimClock } from "@/lib/format";
import type { LinkView } from "@/server/tracking/links";

const STATE: Record<LinkView["state"], string> = { przed: "jeszcze nieaktywny", aktywny: "aktywny", zakonczony: "zakończony", wylaczony: "wyłączony" };

/** Dispatcher side of the client panel: share one order, extend or switch the link off. */
export function ClientLinkBox({ orderId }: { orderId: string }) {
  const { data: snapshot } = useSnapshot();
  const queryClient = useQueryClient();
  const key = ["tracking-link", orderId] as const;
  const q = useQuery({ queryKey: [...key, snapshot?.simNow], queryFn: () => getJson<{ link: LinkView | null }>(`/api/orders/${orderId}/tracking`), enabled: Boolean(snapshot) });
  const act = useMutation({
    mutationFn: (action: "create" | "extend" | "revoke") => postJson<{ link: LinkView | null }>(`/api/orders/${orderId}/tracking`, { action }),
    onSuccess: (_d, action) => {
      void queryClient.invalidateQueries({ queryKey: key });
      if (action === "extend") toast.success("Śledzenie przedłużone o 2 h.");
      if (action === "revoke") toast.success("Link wyłączony.");
    },
    onError: (e) => toast.error(e.message),
  });
  const link = q.data?.link ?? null;
  const url = link && typeof window !== "undefined" ? `${window.location.origin}${link.path}` : "";

  return (
    <section className="rounded-lg border p-3" data-testid="client-link">
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Link2 className="size-3.5" /> Link dla klienta
      </h3>
      {!link ? (
        <>
          <p className="mb-2 text-xs text-muted-foreground">Klient zobaczy tylko to zlecenie: rejestracje, status, ETA, postęp i mapę — od ETD do umówionego ETA, bez danych kierowcy.</p>
          <Button size="sm" variant="outline" onClick={() => act.mutate("create")} disabled={act.isPending} data-testid="create-client-link">
            <Link2 /> Utwórz link
          </Button>
        </>
      ) : (
        <div className="space-y-2 text-xs">
          <div>
            Stan: <strong>{STATE[link.state]}</strong> · widoczny {formatSimClock(link.from)} – {formatSimClock(link.to)}
            {link.extendedMinutes > 0 && <span className="text-muted-foreground"> (przedłużony o {link.extendedMinutes / 60} h)</span>}
          </div>
          {link.etaLate && <p className="rounded bg-warn-soft p-1.5">Prognoza ETA wypada po końcu widoczności — przedłuż śledzenie.</p>}
          <div className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 font-mono text-[11px]">
            <span className="truncate" data-testid="client-link-url">
              {url}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => toast.success("Link skopiowany."));
              }}
            >
              <Copy /> Kopiuj
            </Button>
            <Button size="xs" variant="outline" asChild>
              <a href={link.path} target="_blank" rel="noreferrer" data-testid="open-client-link">
                <ExternalLink /> Podgląd
              </a>
            </Button>
            <Button size="xs" variant="outline" onClick={() => act.mutate("extend")} disabled={act.isPending} data-testid="extend-client-link">
              <Timer /> Przedłuż o 2 h
            </Button>
            <Button size="xs" variant="ghost" onClick={() => act.mutate("revoke")} disabled={act.isPending}>
              <X /> Wyłącz
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
