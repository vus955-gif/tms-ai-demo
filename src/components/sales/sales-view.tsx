"use client";

import { useQuery } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSnapshot } from "@/hooks/use-snapshot";
import { getJson } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { groupThousands } from "@/domain/sales-pricing";
import { cn } from "@/lib/utils";
import type { QuoteListItem } from "@/server/sales/views";
import { MODE, QUOTE_STATUS } from "./labels";
import { QuoteDetail } from "./quote-detail";
import { SalesSettingsDialog } from "./sales-settings";

export function SalesView() {
  const { data: snapshot } = useSnapshot();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [settings, setSettings] = useState(false);
  const list = useQuery({
    queryKey: ["sales", snapshot?.simNow],
    queryFn: () => getJson<{ quotes: QuoteListItem[] }>("/api/sales"),
    enabled: Boolean(snapshot),
    placeholderData: (prev) => prev,
  });
  const quotes = list.data?.quotes ?? [];
  const selected = params.get("q") ?? quotes[0]?.id ?? null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[330px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h1 className="text-sm font-semibold">Wyceny</h1>
          <Button size="sm" variant="ghost" onClick={() => setSettings(true)} data-testid="sales-settings">
            <Settings2 /> Ustawienia
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="quote-list">
          {quotes.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => router.replace(`${pathname}?q=${q.id}`, { scroll: false })}
                aria-current={q.id === selected ? "true" : undefined}
                data-testid={`quote-${q.number}`}
                className={cn("w-full border-b px-3 py-2 text-left hover:bg-accent/60", q.id === selected && "bg-accent")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    <span aria-hidden>{MODE[q.mode].icon}</span> {q.number}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{formatTime(q.createdSim)}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{q.clientName}</div>
                <div className="truncate text-xs">{q.route}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", QUOTE_STATUS[q.status].className)}>{QUOTE_STATUS[q.status].label}</span>
                  {q.mode !== "road" && q.sent > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      odpowiedzi {q.answered}/{q.sent}
                    </span>
                  )}
                  {q.bestPrice && (
                    <span className="text-[10px] text-muted-foreground">
                      {q.mode === "road" ? "cena" : "od"} {groupThousands(Math.round(q.bestPrice.amount))} {q.bestPrice.currency}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
          {list.data && quotes.length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">
              Brak wycen. Zapytania ofertowe przychodzą mailem (pierwsze ok. 10:40 symulacji) — albo napisz je w „Poczcie klienta”, np. przykład „Wycena”.
            </li>
          )}
        </ul>
      </aside>
      {selected ? <QuoteDetail key={selected} id={selected} /> : <div className="flex items-center justify-center text-sm text-muted-foreground">Wybierz wycenę z listy.</div>}
      {settings && <SalesSettingsDialog onClose={() => setSettings(false)} />}
    </div>
  );
}
