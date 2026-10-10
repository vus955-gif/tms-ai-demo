"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SNAPSHOT_KEY, useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatSimClock, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ThreadDetail, ThreadSummary } from "@/server/messages/threads";
import { CategoryChip } from "./category-chip";

const PRIORITY_DOT: Record<string, string> = { wysoki: "bg-bad", normalny: "bg-warn", niski: "bg-muted-foreground/40" };
const MAX = 500;

export function MessengerView() {
  const { data: snapshot } = useSnapshot();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const vehicleParam = params.get("v");
  const fromVehicle = vehicleParam ? snapshot?.fleet.find((v) => v.id === vehicleParam)?.driverId : undefined;
  const selected = params.get("d") ?? fromVehicle ?? null;

  const threads = useQuery({
    queryKey: ["threads", snapshot?.simNow],
    queryFn: () => getJson<{ threads: ThreadSummary[] }>("/api/messages"),
    enabled: Boolean(snapshot),
    placeholderData: (prev) => prev,
  });
  const thread = useQuery({
    queryKey: ["thread", selected, snapshot?.simNow],
    queryFn: () => getJson<ThreadDetail>(`/api/messages/${selected}`),
    enabled: Boolean(snapshot && selected),
    placeholderData: (prev) => (prev?.driverId === selected ? prev : undefined),
  });

  const markRead = useMutation({
    mutationFn: (driverId: string) => postJson(`/api/messages/${driverId}/read`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
    },
  });
  const unread = threads.data?.threads.find((t) => t.driverId === selected)?.unread ?? 0;
  const { mutate: markThreadRead, isPending: marking } = markRead;
  useEffect(() => {
    if (selected && unread > 0 && !marking) markThreadRead(selected);
  }, [selected, unread, marking, markThreadRead]);

  const select = (driverId: string) => router.replace(`${pathname}?d=${driverId}`, { scroll: false });

  return (
    <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)_280px]">
      <aside className="flex min-h-0 flex-col border-r bg-background">
        <h1 className="border-b px-3 py-2.5 text-sm font-semibold">Kierowcy</h1>
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="thread-list">
          {threads.data?.threads.map((t) => (
            <li key={t.driverId}>
              <button
                type="button"
                onClick={() => select(t.driverId)}
                aria-current={t.driverId === selected ? "true" : undefined}
                data-testid={`thread-${t.driverId}`}
                className={cn("w-full border-b px-3 py-2 text-left transition-colors hover:bg-accent/60", t.driverId === selected && "bg-accent")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", t.unread > 0 && "font-semibold")}>
                    {t.priority && t.unread > 0 && <span className={cn("mr-1.5 inline-block size-2 rounded-full", PRIORITY_DOT[t.priority])} aria-label={`priorytet ${t.priority}`} />}
                    {t.driverName}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{t.lastAt ? formatTime(t.lastAt) : ""}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    {t.lastBody ? `${t.lastDirection === "out" ? "Ty: " : ""}${t.lastBody.split("\n")[0]}` : `${t.plates} · brak wiadomości`}
                  </span>
                  {t.unread > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold text-brand-foreground">{t.unread}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      {selected && thread.data ? (
        <Conversation key={selected} detail={thread.data} />
      ) : (
        <div className="flex items-center justify-center text-sm text-muted-foreground">Wybierz kierowcę z listy.</div>
      )}
      <aside className="min-h-0 overflow-y-auto border-l bg-background p-3 text-sm">
        {thread.data ? (
          <div className="space-y-3">
            <div>
              <div className="font-semibold">{thread.data.driverName}</div>
              <div className="text-xs text-muted-foreground">
                {thread.data.plates}
                {thread.data.trailerPlates ? ` + ${thread.data.trailerPlates}` : ""} · {thread.data.phone}
              </div>
            </div>
            {thread.data.order ? (
              <div className="space-y-1 rounded-lg border p-2.5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Bieżące zlecenie</div>
                <div className="font-medium">
                  {thread.data.order.number} · {thread.data.order.statusLabel}
                </div>
                <div className="text-xs">{thread.data.order.routeLabel}</div>
                <div className="text-xs text-muted-foreground">{thread.data.order.clientName}</div>
                <div className="text-xs text-muted-foreground">okno rozładunku do {formatTime(thread.data.order.deliveryTo)}</div>
                {thread.data.order.eta && <div className="text-xs">ETA {formatTime(thread.data.order.eta)}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Kierowca nie ma teraz zlecenia.</p>
            )}
            {snapshot?.fleet.find((v) => v.driverId === thread.data!.driverId) && (
              <Link href={`/monitoring?v=${snapshot.fleet.find((v) => v.driverId === thread.data!.driverId)!.id}`} className="text-xs text-brand underline">
                Pokaż na mapie
              </Link>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function Conversation({ detail }: { detail: ThreadDetail }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const count = detail.messages.length;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count]);
  const send = useMutation({
    mutationFn: (body: string) => postJson<ThreadDetail>(`/api/messages/${detail.driverId}`, { body }),
    onSuccess: (next, body) => {
      setText((current) => (current.trim() === body ? "" : current));
      queryClient.setQueriesData({ queryKey: ["thread", detail.driverId] }, next);
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const lastIn = [...detail.messages].reverse().find((m) => m.direction === "in");
  const suggestions = lastIn?.aiSuggestedReplies ?? [];
  const tooLong = text.length > MAX;

  return (
    <section className="flex min-h-0 flex-col bg-muted/20">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4" data-testid="conversation">
        {detail.messages.length === 0 && <p className="text-center text-sm text-muted-foreground">Brak wiadomości z tym kierowcą.</p>}
        {detail.messages.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-xs",
                m.direction === "out" ? "rounded-br-sm bg-brand text-brand-foreground" : "rounded-bl-sm border bg-background",
              )}
              data-testid={m.direction === "in" ? "msg-in" : "msg-out"}
            >
              <p className="whitespace-pre-wrap">{m.body || (m.attachments.length ? "📎 zdjęcie" : "")}</p>
              <div className={cn("mt-1 flex flex-wrap items-center gap-1.5 text-[11px]", m.direction === "out" ? "text-brand-foreground/80" : "text-muted-foreground")}>
                <span>{formatSimClock(m.atSim)}</span>
                {m.direction === "out" && m.sentBy === "system" && <span>· automatycznie ({m.kind === "order" ? "zlecenie" : m.kind === "reminder" ? "przypomnienie" : m.kind === "cancellation" ? "odwołanie" : m.kind})</span>}
                {m.direction === "in" && m.aiCategory && <CategoryChip category={m.aiCategory} source={m.classifiedBy} summary={m.aiSummary} />}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="space-y-2 border-t bg-background p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || tooLong) return;
          send.mutate(text.trim());
        }}
      >
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="suggestions">
            {suggestions.map((s) => (
              <button key={s} type="button" className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent" onClick={() => setText(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder={`Napisz do: ${detail.driverName}`}
            aria-label="Treść wiadomości"
            aria-invalid={tooLong || undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button type="submit" disabled={!text.trim() || tooLong || send.isPending} aria-label="Wyślij">
            <Send />
          </Button>
        </div>
        <div className={cn("text-right text-[11px]", tooLong ? "text-destructive" : "text-muted-foreground")}>
          {text.length}/{MAX} · wiadomość pójdzie SMS-em
        </div>
      </form>
    </section>
  );
}
