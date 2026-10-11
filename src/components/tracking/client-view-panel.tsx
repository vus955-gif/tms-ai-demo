"use client";

import { useQuery } from "@tanstack/react-query";
import { Eye, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSnapshot } from "@/hooks/use-snapshot";
import { getJson } from "@/lib/api";
import { formatSimClock } from "@/lib/format";
import type { MailClient } from "@/app/api/client-mail/route";
import type { LinkView } from "@/server/tracking/links";

type Shared = LinkView & { number: string; references: string[] };
const STATE: Record<LinkView["state"], string> = { przed: "od", aktywny: "teraz", zakonczony: "zakończone", wylaczony: "wyłączone" };

/** Demo tool: what a client account would list — only transports shared with that client. */
export function ClientViewButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="client-view-toggle">
        <Eye /> Widok klienta
      </Button>
      {open && <Panel onClose={() => setOpen(false)} />}
    </>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const { data: snapshot } = useSnapshot();
  const [clientId, setClientId] = useState("");
  const clients = useQuery({ queryKey: ["client-mail"], queryFn: () => getJson<{ clients: MailClient[] }>("/api/client-mail") });
  const shared = useQuery({
    queryKey: ["tracking-shared", clientId, snapshot?.simNow],
    queryFn: () => getJson<{ links: Shared[] }>(`/api/tracking?clientId=${encodeURIComponent(clientId)}`),
    enabled: Boolean(clientId),
  });
  return (
    <div className="absolute right-[356px] top-12 z-50 flex w-[360px] flex-col gap-2 rounded-xl border bg-background p-3 shadow-2xl" data-testid="client-view-panel">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Widok klienta</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Zamknij widok klienta">
          <X />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Tak wyglądałoby konto klienta: tylko transporty, którym spedytor utworzył link — nigdy cała flota.</p>
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Klient" data-testid="client-view-client">
        <option value="">Wybierz klienta…</option>
        {clients.data?.clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {clientId && (
        <ul className="divide-y rounded-md border text-sm">
          {shared.data?.links.map((l) => (
            <li key={l.token} className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div>
                <div className="font-medium">
                  {l.number}
                  {l.references.length ? <span className="font-normal text-muted-foreground"> · {l.references.join(", ")}</span> : null}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {STATE[l.state]} {l.state === "przed" ? formatSimClock(l.from) : ""} · do {formatSimClock(l.to)}
                </div>
              </div>
              <a href={l.path} target="_blank" rel="noreferrer" className="text-xs text-brand underline">
                Otwórz
              </a>
            </li>
          ))}
          {shared.data && shared.data.links.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">Brak udostępnionych transportów. Utwórz link w szczegółach pojazdu (Monitoring).</li>}
        </ul>
      )}
    </div>
  );
}
