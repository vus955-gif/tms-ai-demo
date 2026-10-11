"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, Mail, PenLine, Send, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NewOrderDialog } from "@/components/orders/new-order-dialog";
import { windowShort } from "@/components/orders/order-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SNAPSHOT_KEY, useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatSimClock, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InboxItem, InboxMessage, InboxThread } from "@/server/inbox/views";

export const CATEGORY: Record<string, { label: string; className: string }> = {
  zamowienie_transportu: { label: "zamówienie", className: "bg-brand/10 text-brand" },
  zapytanie_o_status: { label: "pytanie o status", className: "bg-ok-soft text-ok" },
  reklamacja: { label: "reklamacja", className: "bg-bad-soft text-bad" },
  zapytanie_ofertowe: { label: "zapytanie ofertowe", className: "bg-ai-soft text-ai" },
  inne: { label: "inne", className: "bg-muted text-muted-foreground" },
};

const PRIORITY_DOT: Record<string, string> = { wysoki: "bg-bad", normalny: "bg-warn", niski: "bg-muted-foreground/40" };

export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  const c = CATEGORY[category] ?? CATEGORY.inne;
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", c.className)}>{c.label}</span>;
}

export function InboxView() {
  const { data: snapshot } = useSnapshot();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const selected = params.get("m");
  const orderParam = params.get("order");

  const items = useQuery({
    queryKey: ["inbox", snapshot?.simNow],
    queryFn: () => getJson<{ items: InboxItem[] }>("/api/inbox"),
    enabled: Boolean(snapshot),
    placeholderData: (prev) => prev,
  });
  const thread = useQuery({
    queryKey: ["inbox-thread", selected, snapshot?.simNow],
    queryFn: () => getJson<InboxThread>(`/api/inbox/${selected}`),
    enabled: Boolean(snapshot && selected),
    placeholderData: (prev) => (prev?.rootId === selected ? prev : undefined),
  });
  const select = (rootId: string) => router.replace(`${pathname}?m=${rootId}`, { scroll: false });

  // "Powiadom klienta" from an alert: prepare the delay notice once, then open it.
  const compose = useMutation({
    mutationFn: (orderId: string) => postJson<{ rootId: string }>("/api/inbox/compose", { orderId }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      select(r.rootId);
    },
    onError: (e) => toast.error(e.message),
  });
  const composed = useRef<string | null>(null);
  const { mutate: composeFor } = compose;
  useEffect(() => {
    if (orderParam && snapshot && composed.current !== orderParam) {
      composed.current = orderParam;
      composeFor(orderParam);
    }
  }, [orderParam, snapshot, composeFor]);

  const markRead = useMutation({
    mutationFn: (rootId: string) => postJson(`/api/inbox/${rootId}`, { action: "read" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
    },
  });
  const unread = items.data?.items.find((i) => i.rootId === selected)?.unread ?? false;
  const { mutate: markThreadRead, isPending: marking } = markRead;
  useEffect(() => {
    if (selected && unread && !marking) markThreadRead(selected);
  }, [selected, unread, marking, markThreadRead]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)_360px]">
      <aside className="flex min-h-0 flex-col border-r bg-background">
        <h1 className="border-b px-3 py-2.5 text-sm font-semibold">Skrzynka klientów</h1>
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="inbox-list">
          {items.data?.items.map((i) => (
            <li key={i.rootId}>
              <button
                type="button"
                onClick={() => select(i.rootId)}
                aria-current={i.rootId === selected ? "true" : undefined}
                data-testid={`mail-${i.rootId}`}
                className={cn("w-full border-b px-3 py-2 text-left transition-colors hover:bg-accent/60", i.rootId === selected && "bg-accent")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", i.unread && "font-semibold")}>
                    {i.priority && i.unread && <span className={cn("mr-1.5 inline-block size-2 rounded-full", PRIORITY_DOT[i.priority])} aria-label={`priorytet ${i.priority}`} />}
                    {i.composed ? `Do: ${i.fromName}` : i.fromName}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(i.lastAtSim)}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{i.clientName}</div>
                <div className={cn("truncate text-xs", i.unread ? "text-foreground" : "text-muted-foreground")}>{i.subject}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <CategoryBadge category={i.category} />
                  {i.orderNumber && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                      {i.orderNumber}
                      {i.orderStatus === "SZKIC" ? " · szkic" : ""}
                    </span>
                  )}
                  {i.hasDraft && <span className="rounded bg-ai-soft px-1.5 py-0.5 text-[10px] text-ai">szkic odpowiedzi</span>}
                  {i.sent && !i.hasDraft && <span className="text-[10px] text-muted-foreground">odpowiedziano</span>}
                </div>
              </button>
            </li>
          ))}
          {items.data && items.data.items.length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">Pusto. Pierwszy mail od klienta przychodzi ok. 09:10 symulacji — albo napisz go sam w „Poczcie klienta”.</li>
          )}
        </ul>
      </aside>
      {selected && thread.data ? <ThreadPane key={selected} thread={thread.data} /> : <div className="col-span-2 flex items-center justify-center text-sm text-muted-foreground">Wybierz wiadomość z listy.</div>}
    </div>
  );
}

function MessageCard({ m, thread }: { m: InboxMessage; thread: InboxThread }) {
  const incoming = m.direction === "in";
  if (m.state === "draft") return null;
  return (
    <article className={cn("rounded-lg border bg-background p-3", !incoming && "border-ok/40 bg-ok-soft/30")} data-testid={incoming ? "mail-in" : "mail-out"}>
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {incoming ? (
            <>
              <strong className="text-foreground">{thread.contact.name}</strong> &lt;{thread.contact.email}&gt;
            </>
          ) : (
            <>
              <strong className="text-foreground">Spedycja</strong> → {thread.contact.email} · wysłano (demo — mail nie wychodzi poza aplikację)
            </>
          )}
        </span>
        <span>{formatSimClock(m.atSim)}</span>
      </header>
      <h2 className="mb-1.5 text-sm font-semibold">{m.subject}</h2>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
    </article>
  );
}

function ThreadPane({ thread }: { thread: InboxThread }) {
  return (
    <>
      <div className="min-h-0 space-y-3 overflow-y-auto bg-muted/30 p-4" data-testid="inbox-thread">
        {thread.messages.map((m) => (
          <MessageCard key={m.id} m={m} thread={thread} />
        ))}
        <DraftEditor thread={thread} />
      </div>
      <AiPanel thread={thread} />
    </>
  );
}

function DraftEditor({ thread }: { thread: InboxThread }) {
  const queryClient = useQueryClient();
  const draft = thread.messages.find((m) => m.state === "draft");
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [draftId, setDraftId] = useState(draft?.id ?? null);
  if (draft && draft.id !== draftId) {
    setDraftId(draft.id);
    setSubject(draft.subject);
    setBody(draft.body);
  }
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    void queryClient.invalidateQueries({ queryKey: ["inbox-thread"] });
  };
  const request = useMutation({
    mutationFn: () => postJson<{ draftId: string }>(`/api/inbox/${thread.rootId}`, { action: "draft" }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  const act = useMutation({
    mutationFn: (action: "send" | "discard") => postJson(`/api/inbox/drafts/${draft!.id}`, action === "send" ? { action, subject, body } : { action }),
    onSuccess: (_d, action) => {
      toast.success(action === "send" ? "Wysłano (w demo mail zostaje w aplikacji)." : "Szkic odrzucony.");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!draft) {
    if (!thread.triage) return null;
    return (
      <Button variant="outline" size="sm" onClick={() => request.mutate()} disabled={request.isPending} data-testid="request-draft">
        <Sparkles /> {request.isPending ? "Przygotowuję szkic…" : "Szkic odpowiedzi"}
      </Button>
    );
  }
  return (
    <section className="space-y-2 rounded-lg border border-ai/40 bg-background p-3" data-testid="draft-editor">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 font-medium text-ai">
          <PenLine className="size-3.5" /> Szkic odpowiedzi {draft.classifiedBy === "ai" ? "· przygotowało AI" : "· z szablonu"}
        </span>
        <span className="text-muted-foreground">do {thread.contact.email}</span>
      </div>
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Temat odpowiedzi" maxLength={200} />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} aria-label="Treść odpowiedzi" maxLength={4000} className="text-sm" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => act.mutate("send")} disabled={act.isPending || !subject.trim() || !body.trim()} data-testid="send-draft">
          <Send /> Wyślij
        </Button>
        <Button size="sm" variant="ghost" onClick={() => act.mutate("discard")} disabled={act.isPending}>
          <Trash2 /> Odrzuć szkic
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Fakty w szkicu pochodzą tylko z danych dla klienta: rejestracje, status, ETA, postęp. Dane kierowcy nigdy tu nie trafiają.</p>
    </section>
  );
}

function AiPanel({ thread }: { thread: InboxThread }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const t = thread.triage;
  const order = thread.order;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    void queryClient.invalidateQueries({ queryKey: ["inbox-thread"] });
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
  };
  const draftAction = useMutation({
    mutationFn: (action: "approve" | "reject") => postJson<{ number?: string }>(`/api/orders/${order!.id}/draft`, { action }),
    onSuccess: (_r, action) => {
      toast.success(action === "approve" ? `${order!.number} zatwierdzone — czeka w Zleceniach na przydział.` : `Szkic ${order!.number} odrzucony.`);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const problems = t?.extracted?.problems ?? [];

  return (
    <aside className="min-h-0 space-y-4 overflow-y-auto border-l bg-background p-3 text-sm" data-testid="inbox-ai">
      <div>
        <div className="text-xs text-muted-foreground">{thread.client.name}</div>
        <div className="font-medium">{thread.contact.name}</div>
      </div>
      {t && (
        <section className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <CategoryBadge category={t.category} />
            {t.priority === "wysoki" && <span className="rounded bg-bad px-1.5 py-0.5 text-[10px] font-medium text-white">wysoki priorytet</span>}
            <span className="text-[11px] text-muted-foreground">{t.classifiedBy === "ai" ? "✦ ocena AI" : "reguły (AI niedostępne)"}</span>
          </div>
          {t.summary && <p>{t.summary}</p>}
        </section>
      )}

      {t?.category === "zapytanie_ofertowe" && (
        <section className="rounded-lg border border-ai/40 bg-ai-soft/40 p-2.5 text-xs" data-testid="sales-soon">
          <div className="mb-1 font-medium text-ai">Sprzedaż – wkrótce</div>
          Wyceny przez zaufanych agentów (Sea / Rail / Air) i wyceny drogowe ze stawek za km to pierwszy etap po testach MVP. Na razie odpowiedz ręcznie albo poproś o szkic.
        </section>
      )}

      {order && order.status === "SZKIC" && (
        <section className="space-y-2 rounded-lg border border-ai/40 p-2.5" data-testid="draft-order">
          <div className="flex items-center justify-between">
            <span className="font-medium">Szkic zlecenia {order.number}</span>
            <span className="rounded bg-ai-soft px-1.5 py-0.5 text-[10px] text-ai">do zatwierdzenia</span>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted-foreground">Trasa</dt>
            <dd>{order.route}</dd>
            <dt className="text-muted-foreground">Załadunek</dt>
            <dd>{windowShort(order.values.pickupFrom, order.values.pickupTo)}</dd>
            <dt className="text-muted-foreground">Rozładunek</dt>
            <dd>{windowShort(order.values.deliveryFrom, order.values.deliveryTo)}</dd>
            <dt className="text-muted-foreground">Ładunek</dt>
            <dd>
              {order.values.cargoPallets} palet · {order.values.cargoKg.toLocaleString("pl-PL")} kg
              {order.values.bodyRequired === "chlodnia" ? " · chłodnia" : ""}
              {order.values.adrRequired ? " · ADR" : ""}
            </dd>
            <dt className="text-muted-foreground">Referencje</dt>
            <dd>{order.values.references.join(", ") || "—"}</dd>
          </dl>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => draftAction.mutate("approve")} disabled={draftAction.isPending} data-testid="approve-draft">
              <Check /> Zatwierdź
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <PenLine /> Popraw
            </Button>
            <Button size="sm" variant="ghost" onClick={() => draftAction.mutate("reject")} disabled={draftAction.isPending}>
              <X /> Odrzuć
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Punkty wybrane wyłącznie z książki punktów klienta. Sprawdź okna i ładunek przed zatwierdzeniem.</p>
        </section>
      )}
      {order && order.status !== "SZKIC" && (
        <section className="rounded-lg border p-2.5 text-xs">
          <div className="font-medium">
            {order.number} · {order.statusLabel}
          </div>
          <div className="text-muted-foreground">{order.route}</div>
          <Link href="/zlecenia" className="text-brand underline">
            Otwórz w Zleceniach
          </Link>
        </section>
      )}

      {t?.category === "zamowienie_transportu" && !order && (
        <section className="space-y-2 rounded-lg border border-warn/50 bg-warn-soft/40 p-2.5 text-xs">
          <div className="font-medium">Nie da się założyć szkicu automatycznie</div>
          {problems.length > 0 && <p>Brakuje: {problems.join(", ")}.</p>}
          <Button size="sm" variant="outline" onClick={() => setCreating(true)} data-testid="create-from-mail">
            <Mail /> Załóż zlecenie z maila
          </Button>
        </section>
      )}

      {thread.clientView && (
        <section className="space-y-1 rounded-lg border p-2.5 text-xs" data-testid="client-view">
          <div className="mb-1 flex items-center gap-1 font-medium">
            <Eye className="size-3.5" /> To widzi klient
          </div>
          <div>
            {thread.clientView.number} · {thread.clientView.status}
          </div>
          {thread.clientView.plates && <div>Pojazd: {[thread.clientView.plates, thread.clientView.trailerPlates].filter(Boolean).join(" / ")}</div>}
          {thread.clientView.progressPct !== null && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                <div className="h-full bg-brand" style={{ width: `${thread.clientView.progressPct}%` }} />
              </div>
              {thread.clientView.progressPct}%
            </div>
          )}
          {thread.clientView.eta && <div>ETA {formatSimClock(thread.clientView.eta)}</div>}
          <div className="text-muted-foreground">okno rozładunku do {formatTime(thread.clientView.deliveryWindow.to)}</div>
        </section>
      )}

      {editing && order && <NewOrderDialog key={`edit-${order.id}`} open onOpenChange={(o) => !o && setEditing(false)} draft={order} />}
      {creating && t && (
        <NewOrderDialog
          key={`mail-${thread.rootId}`}
          open
          onOpenChange={(o) => !o && setCreating(false)}
          fromEmail={{ messageId: thread.rootId, clientId: thread.client.id, extracted: t.extracted }}
        />
      )}
    </aside>
  );
}
