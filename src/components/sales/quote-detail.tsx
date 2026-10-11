"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, ChevronDown, ChevronRight, HandCoins, Mail, PenLine, Send, Sparkles, Trash2, Trophy, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { offerPrice, groupThousands } from "@/domain/sales-pricing";
import type { QuoteDetails } from "@/domain/quote-rules";
import { SNAPSHOT_KEY, useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatSimClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AgentRow, QuoteDetailView, ThreadEntry } from "@/server/sales/views";
import { AGENT_STATUS, MODE, QUOTE_STATUS, VEHICLE } from "./labels";

const money = (amount: number, currency: string) => `${groupThousands(Math.round(amount))} ${currency}`;

function useQuoteActions(id: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["sales"] });
    void queryClient.invalidateQueries({ queryKey: ["sales-quote"] });
    void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
  };
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => postJson<Record<string, unknown>>(`/api/sales/${id}`, body),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  return { act, refresh };
}

export function QuoteDetail({ id }: { id: string }) {
  const { data: snapshot } = useSnapshot();
  const q = useQuery({
    queryKey: ["sales-quote", id, snapshot?.simNow],
    queryFn: () => getJson<QuoteDetailView>(`/api/sales/${id}`),
    enabled: Boolean(snapshot),
    placeholderData: (prev) => (prev?.id === id ? prev : undefined),
  });
  const { act } = useQuoteActions(id);
  const d = q.data;
  if (!d) return <div className="p-6 text-sm text-muted-foreground">Wczytywanie wyceny…</div>;
  const closed = ["wygrana", "przegrana", "anulowana"].includes(d.status);

  return (
    <div className="min-h-0 space-y-4 overflow-y-auto p-4" data-testid="quote-detail">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            <span aria-hidden>{MODE[d.mode].icon}</span> {d.number} · transport {MODE[d.mode].label}
          </h2>
          <p className="text-sm text-muted-foreground">
            {d.client.name} · {d.contact.name} &lt;{d.contact.email}&gt;
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded px-2 py-0.5 text-xs font-medium", QUOTE_STATUS[d.status].className)} data-testid="quote-status">
            {QUOTE_STATUS[d.status].label}
          </span>
          {!closed && (
            <>
              <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "outcome", value: "wygrana" })}>
                <Trophy /> Wygrana
              </Button>
              <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: "outcome", value: "przegrana" })}>
                <X /> Przegrana
              </Button>
            </>
          )}
        </div>
      </header>

      {d.source && <SourceEmail source={d.source} />}
      <DetailsCard quote={d} />

      {d.status === "do_zatwierdzenia" && (
        <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ai/40 bg-ai-soft/40 p-3 text-sm">
          <span>Automat jest wyłączony: potwierdzenie dla klienta i zapytania do agentów czekają na zgodę.</span>
          <Button size="sm" onClick={() => act.mutate({ action: "approve" })} disabled={act.isPending} data-testid="approve-rfq">
            <Send /> Wyślij potwierdzenie i zapytania
          </Button>
        </section>
      )}

      {d.mode === "road" ? <RoadCalculator quote={d} /> : d.agents.length > 0 && <AgentsTable quote={d} />}

      <OfferSection quote={d} />
      <ClientThread quote={d} />
    </div>
  );
}

function SourceEmail({ source }: { source: NonNullable<QuoteDetailView["source"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border bg-background p-3 text-sm">
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="flex items-center gap-1.5 font-medium">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <Mail className="size-4" /> Zapytanie klienta: {source.subject}
        </span>
        <span className="text-xs text-muted-foreground">{formatSimClock(source.atSim)}</span>
      </button>
      {open && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{source.body}</p>}
      <Link href={`/skrzynka?m=${source.rootId}`} className="mt-1 inline-block text-xs text-brand underline">
        Otwórz w Skrzynce
      </Link>
    </section>
  );
}

type FieldDef = { key: keyof QuoteDetails; label: string; type: "text" | "number" | "select" | "bool"; options?: string[] };

const FIELDS: Record<QuoteDetailView["mode"], FieldDef[]> = {
  sea: [
    { key: "seaType", label: "FCL / LCL", type: "select", options: ["FCL", "LCL"] },
    { key: "containerType", label: "Kontener", type: "select", options: ["20", "40", "40HC"] },
    { key: "containers", label: "Liczba kontenerów", type: "number" },
    { key: "packages", label: "Opakowania (LCL)", type: "number" },
    { key: "volumeCbm", label: "CBM (LCL)", type: "number" },
    { key: "incoterms", label: "Incoterms", type: "text" },
  ],
  air: [
    { key: "packages", label: "Opakowania", type: "number" },
    { key: "volumeCbm", label: "CBM", type: "number" },
    { key: "incoterms", label: "Incoterms", type: "text" },
  ],
  rail: [
    { key: "containerType", label: "Kontener", type: "select", options: ["20", "40", "40HC"] },
    { key: "containers", label: "Liczba kontenerów", type: "number" },
    { key: "incoterms", label: "Incoterms", type: "text" },
  ],
  road: [
    { key: "pallets", label: "Palety", type: "number" },
    { key: "vehicleKind", label: "Pojazd", type: "select", options: ["bus", "solo", "tractor"] },
    { key: "dangerous", label: "ADR", type: "bool" },
    { key: "reefer", label: "Chłodnia", type: "bool" },
  ],
};

const COMMON: FieldDef[] = [
  { key: "origin", label: "Skąd", type: "text" },
  { key: "destination", label: "Dokąd", type: "text" },
  { key: "weightKg", label: "Waga [kg]", type: "number" },
  { key: "commodity", label: "Towar", type: "text" },
  { key: "readyDate", label: "Gotowość / termin", type: "text" },
];

function DetailsCard({ quote }: { quote: QuoteDetailView }) {
  const { act } = useQuoteActions(quote.id);
  const editable = ["niekompletne", "do_zatwierdzenia"].includes(quote.status) || (quote.mode === "road" && quote.status === "gotowe");
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries([...COMMON, ...FIELDS[quote.mode]].map((f) => [f.key, f.type === "bool" ? Boolean(quote.details[f.key]) : String(quote.details[f.key] ?? "")])),
  );
  const fields = [...COMMON, ...FIELDS[quote.mode]];
  const save = () => {
    const patch = Object.fromEntries(
      fields.map((f) => {
        const v = values[f.key];
        if (f.type === "bool") return [f.key, Boolean(v)];
        if (v === "") return [f.key, null];
        return [f.key, f.type === "number" ? Number(String(v).replace(",", ".")) : String(v)];
      }),
    );
    act.mutate({ action: "details", patch }, { onSuccess: () => toast.success("Dane zapisane.") });
  };
  return (
    <section className="rounded-lg border bg-background p-3" data-testid="quote-details">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Dane do wyceny</h3>
        <span className="text-[11px] text-muted-foreground">{quote.extractedBy === "ai" ? "✦ odczyt AI" : "odczyt regułami (AI niedostępne)"}</span>
      </div>
      {quote.missing.length > 0 && (
        <p className="mb-2 rounded-md bg-warn-soft p-2 text-xs" data-testid="quote-missing">
          Brakuje: <strong>{quote.missing.join(", ")}</strong>. {quote.mode === "road" ? "Uzupełnij, a wycena przeliczy się sama." : "Klient dostał szkic prośby o uzupełnienie; możesz też wpisać dane sam."}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {fields.map((f) => (
          <label key={f.key} className={cn("grid gap-1 text-xs", f.type === "bool" && "flex items-center gap-2")}>
            <span className="text-muted-foreground">{f.label}</span>
            {f.type === "bool" ? (
              <input type="checkbox" className="size-4" checked={Boolean(values[f.key])} disabled={!editable} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.checked }))} />
            ) : f.type === "select" ? (
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-70"
                value={String(values[f.key])}
                disabled={!editable}
                onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
              >
                <option value="">—</option>
                {f.options!.map((o) => (
                  <option key={o} value={o}>
                    {f.key === "vehicleKind" ? VEHICLE[o as keyof typeof VEHICLE] : o}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={String(values[f.key])}
                disabled={!editable}
                inputMode={f.type === "number" ? "decimal" : undefined}
                onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                className="h-8"
                aria-label={f.label}
              />
            )}
          </label>
        ))}
      </div>
      {editable && (
        <Button size="sm" variant="outline" className="mt-2" onClick={save} disabled={act.isPending} data-testid="save-details">
          Zapisz dane
        </Button>
      )}
    </section>
  );
}

function AgentsTable({ quote }: { quote: QuoteDetailView }) {
  const { act } = useQuoteActions(quote.id);
  const priced = quote.agents.filter((a) => a.status === "odpowiedz" && a.price !== null);
  const [selected, setSelected] = useState<string | null>(quote.selectedQuoteId ?? priced[0]?.agentQuoteId ?? null);
  const [margin, setMargin] = useState(String(quote.marginPct ?? quote.defaultMarginPct));
  const current = priced.find((a) => a.agentQuoteId === selected) ?? null;
  const marginNum = Number(margin.replace(",", "."));
  const preview = current?.price && Number.isFinite(marginNum) ? offerPrice(current.price, marginNum) : null;
  const applied = quote.selectedQuoteId === selected && quote.marginPct === marginNum;
  const editable = ["zbieranie", "gotowe", "oferta_wyslana"].includes(quote.status);

  return (
    <section className="rounded-lg border bg-background p-3" data-testid="agents-table">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Stawki agentów</h3>
        {quote.deadlineSim && <span className="text-[11px] text-muted-foreground">termin odpowiedzi: {formatSimClock(quote.deadlineSim)}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 pr-2" />
              <th className="py-1.5 pr-2">Agent</th>
              <th className="py-1.5 pr-2">Status</th>
              <th className="py-1.5 pr-2 text-right">Stawka</th>
              <th className="py-1.5 pr-2">Tranzyt</th>
              <th className="py-1.5 pr-2">Ważna do</th>
              <th className="py-1.5">Warunki</th>
            </tr>
          </thead>
          <tbody>
            {quote.agents.map((a) => (
              <AgentLine key={a.agentQuoteId} quote={quote} agent={a} selected={selected === a.agentQuoteId} onSelect={() => setSelected(a.agentQuoteId)} editable={editable} />
            ))}
          </tbody>
        </table>
      </div>
      {priced.length > 0 && editable && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-md bg-muted/50 p-2.5 text-sm">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Marża %</span>
            <Input value={margin} onChange={(e) => setMargin(e.target.value)} className="h-8 w-20" inputMode="decimal" aria-label="Marża w procentach" data-testid="margin" />
          </label>
          {current && preview !== null && (
            <div className="text-xs">
              <div className="text-muted-foreground">
                zakup {money(current.price!, current.currency ?? "")} + {marginNum}% =
              </div>
              <div className="text-base font-semibold" data-testid="offer-preview">
                {money(preview, current.currency ?? "")}
              </div>
            </div>
          )}
          <Button size="sm" variant={applied ? "ghost" : "outline"} disabled={!selected || !Number.isFinite(marginNum) || act.isPending} onClick={() => act.mutate({ action: "select", agentQuoteId: selected, marginPct: marginNum })} data-testid="apply-rate">
            <Calculator /> {applied ? "Zastosowano" : "Zastosuj stawkę i marżę"}
          </Button>
        </div>
      )}
    </section>
  );
}

function AgentLine({ quote, agent, selected, onSelect, editable }: { quote: QuoteDetailView; agent: AgentRow; selected: boolean; onSelect: () => void; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(agent.price ? String(Math.round(agent.price * 0.92)) : "");
  const { act } = useQuoteActions(quote.id);
  const draft = agent.thread.find((m) => m.state === "draft");
  const priced = agent.status === "odpowiedz" && agent.price !== null;
  return (
    <>
      <tr className={cn("border-b align-top", selected && "bg-ok-soft/40")} data-testid={`agent-${agent.agentId}`}>
        <td className="py-1.5 pr-2">{priced && <input type="radio" name={`rate-${quote.id}`} checked={selected} onChange={onSelect} aria-label={`Wybierz stawkę ${agent.company}`} />}</td>
        <td className="py-1.5 pr-2">
          <button type="button" className="flex items-center gap-1 text-left font-medium" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {agent.company}
          </button>
          <div className="pl-4 text-[11px] text-muted-foreground">{agent.contactName}</div>
        </td>
        <td className={cn("py-1.5 pr-2 text-xs", AGENT_STATUS[agent.status].className)}>{AGENT_STATUS[agent.status].label}</td>
        <td className="py-1.5 pr-2 text-right font-medium tabular-nums">{priced ? money(agent.price!, agent.currency ?? "") : "—"}</td>
        <td className="py-1.5 pr-2 text-xs">{agent.transitDays ? `${agent.transitDays} dni` : "—"}</td>
        <td className="py-1.5 pr-2 text-xs">{agent.validUntil ?? "—"}</td>
        <td className="py-1.5 text-xs text-muted-foreground">
          {agent.conditions ?? "—"}
          {agent.readBy && <span className="ml-1 text-[10px]">({agent.readBy === "ai" ? "✦ AI" : "reguły"})</span>}
        </td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/30">
          <td />
          <td colSpan={6} className="space-y-2 py-2 pr-2">
            {agent.thread.filter((m) => m.state !== "draft").map((m) => (
              <MessageBox key={m.id} m={m} from={m.direction === "in" ? agent.company : "My"} />
            ))}
            {priced && editable && !draft && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Cena docelowa ({agent.currency})</span>
                  <Input value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 w-28" inputMode="decimal" aria-label="Cena docelowa" />
                </label>
                <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "negotiate", agentQuoteId: agent.agentQuoteId, target: Number(target) })} disabled={act.isPending || !Number(target)} data-testid={`negotiate-${agent.agentId}`}>
                  <HandCoins /> Szkic negocjacji
                </Button>
              </div>
            )}
            {draft && <DraftBox draft={draft} endpoint={`/api/sales/agent-drafts/${draft.id}`} sendLabel="Wyślij do agenta" />}
          </td>
        </tr>
      )}
    </>
  );
}

function RoadCalculator({ quote }: { quote: QuoteDetailView }) {
  const { act } = useQuoteActions(quote.id);
  const c = quote.calculation;
  const [km, setKm] = useState(c?.kmOverride ? String(c.kmOverride) : "");
  const [empty, setEmpty] = useState(String(c?.emptyKm ?? 0));
  const [margin, setMargin] = useState(String(c?.marginPct ?? quote.defaultMarginPct));
  const [vehicle, setVehicle] = useState<string>(c?.vehicleKind ?? "");
  const recalc = () =>
    act.mutate({
      action: "road",
      kmOverride: km ? Number(km) : null,
      emptyKm: Number(empty) || 0,
      marginPct: Number(margin.replace(",", ".")),
      ...(vehicle ? { vehicleKind: vehicle } : {}),
    });
  return (
    <section className="rounded-lg border bg-background p-3" data-testid="road-calc">
      <h3 className="mb-2 text-sm font-semibold">Kalkulacja drogowa (własna flota)</h3>
      {c ? (
        <table className="mb-3 w-full max-w-lg text-sm">
          <tbody className="[&_td]:py-0.5">
            <tr>
              <td className="text-muted-foreground">Pojazd</td>
              <td className="text-right">{c.vehicleLabel}</td>
            </tr>
            <tr>
              <td className="text-muted-foreground">Kilometry ({c.kmLabel ?? c.kmSource})</td>
              <td className="text-right tabular-nums">
                {groupThousands(c.loadedKm)} km{c.emptyKm ? ` + ${c.emptyKm} km dojazdu` : ""}
              </td>
            </tr>
            <tr>
              <td className="text-muted-foreground">Stawka</td>
              <td className="text-right tabular-nums">
                {c.perKm.toFixed(2)} {c.currency}/km (minimum {money(c.minimum, c.currency)})
              </td>
            </tr>
            <tr>
              <td className="text-muted-foreground">Fracht</td>
              <td className="text-right tabular-nums">{money(c.base, c.currency)}</td>
            </tr>
            {c.surcharges.map((s) => (
              <tr key={s.label}>
                <td className="text-muted-foreground">
                  Dopłata {s.label} ({s.pct}%)
                </td>
                <td className="text-right tabular-nums">{money(s.amount, c.currency)}</td>
              </tr>
            ))}
            <tr className="border-t">
              <td className="text-muted-foreground">Koszt</td>
              <td className="text-right tabular-nums">{money(c.cost, c.currency)}</td>
            </tr>
            <tr>
              <td className="font-medium">Cena dla klienta (marża {c.marginPct}%)</td>
              <td className="text-right text-base font-semibold tabular-nums" data-testid="road-price">
                {money(c.price, c.currency)}
              </td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="mb-2 text-sm text-muted-foreground">Brak kalkulacji — uzupełnij dane albo wpisz kilometry.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Km (ręcznie)</span>
          <Input value={km} onChange={(e) => setKm(e.target.value)} className="h-8 w-24" placeholder="auto" inputMode="numeric" aria-label="Kilometry ręcznie" />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Km dojazdu</span>
          <Input value={empty} onChange={(e) => setEmpty(e.target.value)} className="h-8 w-20" inputMode="numeric" aria-label="Kilometry dojazdu" />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Marża %</span>
          <Input value={margin} onChange={(e) => setMargin(e.target.value)} className="h-8 w-20" inputMode="decimal" aria-label="Marża drogowa" />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Pojazd</span>
          <select className="h-8 rounded-md border bg-background px-2 text-sm" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
            <option value="">auto</option>
            {Object.entries(VEHICLE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="outline" onClick={recalc} disabled={act.isPending} data-testid="recalc-road">
          <Calculator /> Przelicz
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Stawki i marża z ustawień Sprzedaży. Kilometry z tras OSRM dla punktów klienta; dla innych miast — szacunek (linia prosta × 1,3).</p>
    </section>
  );
}

function OfferSection({ quote }: { quote: QuoteDetailView }) {
  const { act } = useQuoteActions(quote.id);
  const draft = quote.clientThread.find((m) => m.state === "draft" && m.kind === "draft_offer");
  const ready = quote.mode === "road" ? Boolean(quote.calculation) : Boolean(quote.offer);
  if (["niekompletne", "do_zatwierdzenia"].includes(quote.status)) return null;
  return (
    <section className="rounded-lg border bg-background p-3" data-testid="offer-section">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Oferta dla klienta</h3>
        {quote.offer && quote.mode !== "road" && (
          <span className="text-xs text-muted-foreground">
            cena oferty: <strong className="text-foreground">{money(quote.offer.price, quote.offer.currency)}</strong>
          </span>
        )}
      </div>
      {draft ? (
        <DraftBox draft={draft} endpoint={`/api/inbox/drafts/${draft.id}`} sendLabel="Wyślij ofertę" />
      ) : (
        <Button size="sm" onClick={() => act.mutate({ action: "offer" })} disabled={!ready || act.isPending} data-testid="draft-offer">
          <Sparkles /> {act.isPending ? "Przygotowuję…" : "Szkic oferty"}
        </Button>
      )}
      {!ready && quote.mode !== "road" && <p className="mt-1 text-xs text-muted-foreground">Najpierw wybierz stawkę agenta i zastosuj marżę.</p>}
    </section>
  );
}

function ClientThread({ quote }: { quote: QuoteDetailView }) {
  const items = quote.clientThread.filter((m) => m.id !== quote.source?.rootId && !(m.state === "draft" && m.kind === "draft_offer"));
  if (items.length === 0) return null;
  return (
    <section className="space-y-2 rounded-lg border bg-background p-3">
      <h3 className="text-sm font-semibold">Korespondencja z klientem</h3>
      {items.map((m) =>
        m.state === "draft" ? (
          <DraftBox key={m.id} draft={m} endpoint={`/api/inbox/drafts/${m.id}`} sendLabel="Wyślij do klienta" />
        ) : (
          <MessageBox key={m.id} m={m} from={m.direction === "in" ? quote.contact.name : "My"} />
        ),
      )}
    </section>
  );
}

function MessageBox({ m, from }: { m: ThreadEntry; from: string }) {
  return (
    <article className={cn("rounded-md border p-2 text-xs", m.direction === "out" ? "bg-ok-soft/30" : "bg-background")}>
      <div className="mb-1 flex justify-between gap-2 text-muted-foreground">
        <span>
          <strong className="text-foreground">{from}</strong> · {m.subject}
        </span>
        <span>{formatSimClock(m.atSim)}</span>
      </div>
      <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
    </article>
  );
}

function DraftBox({ draft, endpoint, sendLabel }: { draft: ThreadEntry; endpoint: string; sendLabel: string }) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const act = useMutation({
    mutationFn: (action: "send" | "discard") => postJson(endpoint, action === "send" ? { action, subject, body } : { action }),
    onSuccess: (_d, action) => {
      toast.success(action === "send" ? "Wysłano (w demo wiadomość zostaje w aplikacji)." : "Szkic odrzucony.");
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-quote"] });
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-2 rounded-md border border-ai/40 p-2.5" data-testid="sales-draft">
      <div className="flex items-center gap-1 text-xs font-medium text-ai">
        <PenLine className="size-3.5" /> Szkic {draft.classifiedBy === "ai" ? "· przygotowało AI" : "· z szablonu"}
      </div>
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Temat szkicu" maxLength={200} />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} aria-label="Treść szkicu" maxLength={4000} className="text-sm" />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => act.mutate("send")} disabled={act.isPending || !subject.trim() || !body.trim()} data-testid="send-sales-draft">
          <Send /> {sendLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => act.mutate("discard")} disabled={act.isPending}>
          <Trash2 /> Odrzuć
        </Button>
      </div>
    </div>
  );
}
