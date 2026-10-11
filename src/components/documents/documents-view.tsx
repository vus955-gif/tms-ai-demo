"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, FileWarning, ImageOff, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SNAPSHOT_KEY, useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatSimClock, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentView } from "@/server/documents/cmr";

type Queue = "zamkniecie" | "weryfikacja" | "archiwum";

const QUEUES: { id: Queue; label: string; statuses: string[] }[] = [
  { id: "zamkniecie", label: "Do zamknięcia", statuses: ["do_zamkniecia"] },
  { id: "weryfikacja", label: "Do weryfikacji", statuses: ["do_weryfikacji", "nieczytelny"] },
  { id: "archiwum", label: "Archiwum", statuses: ["zatwierdzony", "odrzucony"] },
];

const STATUS: Record<string, { label: string; className: string }> = {
  do_zamkniecia: { label: "do zamknięcia", className: "bg-ok/15 text-ok" },
  do_weryfikacji: { label: "do weryfikacji", className: "bg-warn/15 text-warn" },
  nieczytelny: { label: "nieczytelny", className: "bg-bad/15 text-bad" },
  zatwierdzony: { label: "zlecenie zamknięte", className: "bg-muted text-muted-foreground" },
  odrzucony: { label: "odrzucony", className: "bg-muted text-muted-foreground line-through" },
};

const FIELDS: [string, string][] = [
  ["cmr_number", "Nr CMR"],
  ["sender", "Nadawca (1)"],
  ["consignee", "Odbiorca (2)"],
  ["place_of_delivery", "Miejsce dostawy (3)"],
  ["delivery_date", "Data przyjęcia (24)"],
  ["goods", "Towar"],
  ["packages", "Sztuk"],
  ["weight_kg", "Waga [kg]"],
  ["references", "Referencje"],
];

export function DocumentsView() {
  const { data: snapshot } = useSnapshot();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const docs = useQuery({
    queryKey: ["documents", snapshot?.simNow],
    queryFn: () => getJson<{ documents: DocumentView[] }>("/api/documents"),
    enabled: Boolean(snapshot),
    placeholderData: (prev) => prev,
  });
  const all = docs.data?.documents ?? [];
  const docParam = params.get("doc");
  const linked = docParam ? all.find((d) => d.id === docParam) : undefined;
  const queue = (params.get("q") as Queue | null) ?? QUEUES.find((q) => linked && q.statuses.includes(linked.status))?.id ?? "zamkniecie";
  const statuses = QUEUES.find((q) => q.id === queue)?.statuses ?? [];
  const visible = all.filter((d) => statuses.includes(d.status));
  const selectedId = docParam ?? visible[0]?.id ?? null;
  const selected = all.find((d) => d.id === selectedId) ?? null;
  const go = (next: { q?: Queue; doc?: string | null }) => {
    const sp = new URLSearchParams(params.toString());
    if (next.q) {
      sp.set("q", next.q);
      sp.delete("doc");
    }
    if (next.doc) sp.set("doc", next.doc);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r bg-background">
        <div className="flex gap-1 border-b p-2" role="tablist" aria-label="Kolejki dokumentów">
          {QUEUES.map((q) => {
            const n = all.filter((d) => q.statuses.includes(d.status)).length;
            return (
              <button
                key={q.id}
                type="button"
                role="tab"
                aria-selected={queue === q.id}
                onClick={() => go({ q: q.id })}
                data-testid={`queue-${q.id}`}
                className={cn("flex-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium", queue === q.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60")}
              >
                {q.label}
                {n > 0 && <span className="ml-1 text-[10px] text-muted-foreground">{n}</span>}
              </button>
            );
          })}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="document-list">
          {visible.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => go({ doc: d.id })}
                aria-current={d.id === selected?.id ? "true" : undefined}
                className={cn("flex w-full gap-2 border-b px-3 py-2 text-left hover:bg-accent/60", d.id === selected?.id && "bg-accent")}
                data-testid={`document-${d.imageRef ?? d.id}`}
              >
                <Thumb doc={d} className="h-12 w-10 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{d.matchedOrder?.number ?? "nieprzypisany"}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(d.createdSim)}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{d.driverName}</div>
                  <span className={cn("mt-0.5 inline-block rounded px-1.5 text-[10px] font-medium", STATUS[d.status]?.className)}>{STATUS[d.status]?.label ?? d.status}</span>
                </div>
              </button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">
              {queue === "zamkniecie" ? "Nic do zamknięcia. CMR-y przychodzą od kierowców kilka minut po rozładunku." : "Pusto."}
            </li>
          )}
        </ul>
      </aside>
      {selected ? <DocumentDetail key={selected.id} doc={selected} onDone={() => go({ q: queue })} /> : <div className="flex items-center justify-center text-sm text-muted-foreground">Wybierz dokument z listy.</div>}
    </div>
  );
}

function Thumb({ doc, className }: { doc: Pick<DocumentView, "imageUrl" | "sampleLabel">; className?: string }) {
  if (!doc.imageUrl)
    return (
      <div className={cn("flex items-center justify-center rounded border bg-muted text-muted-foreground", className)} title="Własne zdjęcie — nie jest przechowywane">
        <ImageOff className="size-4" />
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element -- static demo photos
  return <img src={doc.imageUrl} alt={doc.sampleLabel ?? "CMR"} className={cn("rounded border bg-white object-cover", className)} />;
}

function Check3({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      {ok === true ? <Check className="size-4 text-ok" /> : ok === false ? <X className="size-4 text-bad" /> : <CircleAlert className="size-4 text-muted-foreground" />}
      <span>{label}</span>
    </li>
  );
}

function DocumentDetail({ doc, onDone }: { doc: DocumentView; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [orderId, setOrderId] = useState(doc.candidates[0]?.orderId ?? doc.assignable[0]?.id ?? "");
  const [zoom, setZoom] = useState(false);
  const act = useMutation({
    mutationFn: (body: { action: "close" } | { action: "reject" } | { action: "assign"; orderId: string }) => postJson(`/api/documents/${doc.id}`, body),
    onSuccess: (_d, body) => {
      toast.success(body.action === "close" ? "Zlecenie zamknięte." : body.action === "assign" ? "Dokument przypisany — zlecenie czeka na zamknięcie." : "Dokument odrzucony.");
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });
  const extracted = doc.extracted ?? {};
  const q = doc.quality;
  const open = ["do_zamkniecia", "do_weryfikacji", "nieczytelny"].includes(doc.status);

  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(320px,420px)] overflow-hidden" data-testid="document-detail">
      <div className="min-h-0 overflow-auto bg-muted/40 p-4">
        {doc.imageUrl ? (
          <button type="button" onClick={() => setZoom((z) => !z)} className={cn("block", zoom ? "w-[160%] max-w-none" : "mx-auto max-w-2xl")} aria-label={zoom ? "Pomniejsz zdjęcie" : "Powiększ zdjęcie"}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static demo photo */}
            <img src={doc.imageUrl} alt={doc.sampleLabel ?? "Zdjęcie CMR"} className="w-full rounded-md border bg-white shadow-sm" />
          </button>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <ImageOff className="size-8" />
            Własne zdjęcie z telefonu — po odczycie nie jest przechowywane (demo).
          </div>
        )}
      </div>
      <div className="min-h-0 space-y-4 overflow-y-auto border-l bg-background p-4 text-sm">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base font-semibold">{doc.matchedOrder ? `CMR · ${doc.matchedOrder.number}` : "CMR · nieprzypisany"}</h1>
            <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", STATUS[doc.status]?.className)}>{STATUS[doc.status]?.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            od {doc.driverName} · {formatSimClock(doc.createdSim)} · odczyt: {doc.readBy === "ai" ? "AI" : "brak (AI niedostępne)"}
          </p>
          {doc.note && <p className="mt-2 rounded-md bg-warn/10 p-2 text-xs">{doc.note}</p>}
        </div>

        {doc.status === "nieczytelny" && (
          <p className="flex gap-2 rounded-md bg-bad/10 p-2 text-xs">
            <FileWarning className="size-4 shrink-0 text-bad" /> AI uznało zdjęcie za nieczytelne i od razu poprosiło kierowcę SMS-em o nowe — póki jest jeszcze na miejscu rozładunku.
          </p>
        )}

        {q && (
          <section>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kontrola jakości</h2>
            <ul className="space-y-1">
              <Check3 ok={q.legible} label="Zdjęcie czytelne" />
              <Check3 ok={q.stamp} label="Pieczątka odbiorcy (pole 24)" />
              <Check3 ok={q.signature} label="Podpis odbiorcy (pole 24)" />
              <Check3 ok={q.remarks ? false : true} label={q.remarks ? `Adnotacja odbiorcy: „${q.remarks}”` : "Bez adnotacji o szkodach"} />
            </ul>
          </section>
        )}

        {doc.readBy === "ai" && (
          <section>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Odczyt AI</h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
              {FIELDS.map(([key, label]) => {
                const v = extracted[key];
                const text = Array.isArray(v) ? v.join(", ") : v === null || v === undefined || v === "" ? "—" : String(v);
                return (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words">{text}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        )}

        {doc.candidates.length > 0 && (
          <section>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dopasowanie do zleceń</h2>
            <ul className="space-y-1.5">
              {doc.candidates.map((c) => (
                <li key={c.orderId} className="rounded-md border p-2 text-xs">
                  <div className="flex justify-between font-medium">
                    <span>{c.number}</span>
                    <span className={c.score >= 0.85 ? "text-ok" : "text-muted-foreground"}>{Math.round(c.score * 100)}%</span>
                  </div>
                  <div className="text-muted-foreground">{c.reasons.length ? c.reasons.join(" · ") : "nic się nie zgadza"}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {open && (
          <section className="space-y-2 border-t pt-3">
            {doc.status === "do_zamkniecia" && doc.matchedOrder && (
              <Button className="w-full" onClick={() => act.mutate({ action: "close" })} disabled={act.isPending} data-testid="close-order">
                <Check /> Zamknij zlecenie {doc.matchedOrder.number}
              </Button>
            )}
            {doc.status !== "do_zamkniecia" && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="assign-order">
                  Przypisz do zlecenia po rozładunku
                </label>
                <div className="flex gap-2">
                  <select
                    id="assign-order"
                    className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                    data-testid="assign-select"
                  >
                    {doc.assignable.length === 0 && <option value="">Brak zleceń po rozładunku</option>}
                    {doc.assignable.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" onClick={() => act.mutate({ action: "assign", orderId })} disabled={!orderId || act.isPending} data-testid="assign-document">
                    Przypisz
                  </Button>
                </div>
              </div>
            )}
            <Button variant="outline" size="sm" className="w-full" onClick={() => act.mutate({ action: "reject" })} disabled={act.isPending} data-testid="reject-document">
              <X /> Odrzuć dokument
            </Button>
            <p className="text-[11px] text-muted-foreground">Zamknięcie zlecenia zawsze należy do spedytora — AI tylko przygotowuje dokument.</p>
          </section>
        )}
      </div>
    </div>
  );
}
