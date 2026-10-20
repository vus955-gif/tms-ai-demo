"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Info, MailQuestion, PenLine, Send, Sparkles, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SNAPSHOT_KEY, useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatSimClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ShipmentDetail } from "@/server/shipments/views";
import { CLIENT_STATE, delayText, fromWarsawInput, MODE, relative, RHYTHMS, SOURCE, STATUS, toWarsawInput, when } from "./labels";

const ShipmentMap = dynamic(() => import("./shipment-map").then((m) => m.ShipmentMap), { ssr: false, loading: () => <div className="h-64 w-full rounded-lg border bg-muted/40" /> });

const DOCS_URL = "https://github.com/vus955-gif/tms-ai-demo/blob/main/docs/sledzenie-przesylek.md";
const select = "h-8 rounded-md border bg-background px-2 text-xs";

const REF_LABEL: Record<string, string> = {
  booking: "Booking",
  bl: "B/L",
  awb: "AWB",
  container: "Kontener",
  vessel: "Statek / rejs",
  flight: "Lot",
  train: "Pociąg",
  clientRef: "Ref. klienta",
};
const EVENT_LABEL: Record<string, string> = {
  terminal_in: "terminal",
  departed: "wyjazd",
  transshipment: "przeładunek",
  border: "granica",
  arrived: "przybycie",
  customs: "odprawa",
  delivered: "dostawa",
};

function useShipmentAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => postJson<Record<string, unknown>>(`/api/shipments/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["shipments"] });
      void queryClient.invalidateQueries({ queryKey: ["shipment", id] });
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
    },
    onError: (e) => toast.error(e.message),
  });
}

export function ShipmentDetailView({ id }: { id: string }) {
  const { data: snapshot } = useSnapshot();
  const q = useQuery({
    queryKey: ["shipment", id, snapshot?.simNow],
    queryFn: () => getJson<ShipmentDetail>(`/api/shipments/${id}`),
    enabled: Boolean(snapshot),
    placeholderData: (prev) => (prev?.id === id ? prev : undefined),
  });
  const act = useShipmentAction(id);
  const [cancelAsk, setCancelAsk] = useState(false);
  const d = q.data;
  if (q.error) return <div className="p-6 text-sm text-muted-foreground">{q.error.message}</div>;
  if (!d) return <div className="p-6 text-sm text-muted-foreground">Wczytywanie przesyłki…</div>;
  const active = d.status === "planowana" || d.status === "w_drodze";

  return (
    <div className="min-h-0 space-y-4 overflow-y-auto p-4" data-testid="shipment-detail">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            <span aria-hidden>{MODE[d.mode].icon}</span> {d.number} · przesyłka {MODE[d.mode].label}
          </h2>
          <p className="text-sm text-muted-foreground">
            {d.client.name}
            {d.contact && ` · ${d.contact.name} <${d.contact.email}>`}
            {d.quote && (
              <>
                {" · z wyceny "}
                <Link href={`/sprzedaz?q=${d.quote.id}`} className="text-brand underline">
                  {d.quote.number}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded px-2 py-0.5 text-xs font-medium", STATUS[d.status].className)} data-testid="shipment-status">
            {STATUS[d.status].label}
          </span>
          {active &&
            (cancelAsk ? (
              <span className="flex items-center gap-1 text-xs">
                Anulować przesyłkę?
                <Button size="sm" variant="destructive" onClick={() => act.mutate({ action: "cancel" }, { onSuccess: () => toast.success("Przesyłka anulowana.") })}>
                  Tak
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCancelAsk(false)}>
                  Nie
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setCancelAsk(true)}>
                <Ban /> Anuluj
              </Button>
            ))}
        </div>
      </header>

      <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground" data-testid="live-tracking-note">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Pozycja na żywo (AIS statków, trackery lotów, GPS wagonów) nie jest podłączona w demo — to płatne usługi, a demo utrzymuję z własnych środków. Status pochodzi z odpowiedzi agentów, o które
          system prosi sam.{" "}
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="text-brand underline">
            Jak podłączyć dostawców
          </a>
        </span>
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="space-y-1">
          <ShipmentMap data={d.map} />
          <p className="text-[11px] text-muted-foreground">
            Linia przerywana: trasa orientacyjna.{" "}
            {d.map.lastConfirmed ? (
              <>
                Ostatnio potwierdzone: <strong className="text-foreground">{d.map.lastConfirmed.label}</strong> — {d.map.lastConfirmed.name}, {formatSimClock(d.map.lastConfirmed.at)}.
              </>
            ) : (
              "Przesyłka jeszcze nie wyruszyła."
            )}
          </p>
        </section>
        <Facts d={d} />
      </div>

      <Milestones d={d} active={active} simNow={snapshot?.simNow} />
      <ClientUpdates d={d} active={active} simNow={snapshot?.simNow} />
      <AgentSection d={d} active={active} simNow={snapshot?.simNow} />
    </div>
  );
}

function Facts({ d }: { d: ShipmentDetail }) {
  const delay = delayText(d.delayHours);
  const cargo = [d.cargo, d.pieces ? `${d.pieces} szt.` : null, d.weightKg ? `${d.weightKg.toLocaleString("pl-PL")} kg` : null, d.volumeCbm ? `${String(d.volumeCbm).replace(".", ",")} CBM` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className="space-y-2 rounded-lg border bg-background p-3 text-sm" data-testid="shipment-facts">
      <div className="text-xs text-muted-foreground">{d.route}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">ETD (plan)</dt>
        <dd>{formatSimClock(d.etdPlanned)}</dd>
        <dt className="text-muted-foreground">ETA (plan)</dt>
        <dd>{formatSimClock(d.etaPlanned)}</dd>
        <dt className="text-muted-foreground">{d.status === "dostarczona" ? "Przybycie" : "ETA aktualne"}</dt>
        <dd data-testid="eta-current">
          <strong>{formatSimClock(d.etaCurrent)}</strong>
          {delay && <span className={cn("ml-1.5 rounded px-1 py-0.5 text-[10px] font-medium", d.delayHours > 0 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>{delay}</span>}
        </dd>
        {d.statusNote && (
          <>
            <dt className="text-muted-foreground">Uwagi agenta</dt>
            <dd>{d.statusNote}</dd>
          </>
        )}
        {cargo && (
          <>
            <dt className="text-muted-foreground">Ładunek</dt>
            <dd>{cargo}</dd>
          </>
        )}
        {d.incoterms && (
          <>
            <dt className="text-muted-foreground">Incoterms</dt>
            <dd>{d.incoterms}</dd>
          </>
        )}
        {Object.entries(d.refs)
          .filter(([k, v]) => v && REF_LABEL[k])
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{REF_LABEL[k]}</dt>
              <dd className="font-mono text-[11px]">{v}</dd>
            </div>
          ))}
        {d.agentInfo && (
          <>
            <dt className="text-muted-foreground">Agent</dt>
            <dd>
              {d.agentInfo.company} · {d.agentInfo.contactName}
              <span className="block text-[11px] text-muted-foreground">
                {d.agentInfo.email} · pisze {d.agentInfo.language === "en" ? "po angielsku" : "po polsku"}
              </span>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

function Milestones({ d, active, simNow }: { d: ShipmentDetail; active: boolean; simNow: string | undefined }) {
  const act = useShipmentAction(d.id);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const nextId = d.milestones.find((m) => !m.actual)?.id;
  return (
    <section className="rounded-lg border bg-background p-3" data-testid="milestones">
      <h3 className="mb-2 text-sm font-semibold">Etapy</h3>
      <ol className="space-y-1">
        {d.milestones.map((m) => {
          const src = SOURCE[m.source] ?? SOURCE.plan;
          return (
            <li key={m.id} className={cn("grid grid-cols-[1fr_auto] items-center gap-2 rounded px-2 py-1 text-xs sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]", m.id === nextId && active && "bg-accent/60")}>
              <span className="flex items-center gap-1.5">
                <span className={cn("inline-block size-2 shrink-0 rounded-full", m.actual ? "bg-ok" : "border border-muted-foreground")} aria-hidden />
                <span>
                  <strong className="font-medium">{m.label}</strong> <span className="text-muted-foreground">· {m.location}</span>
                </span>
              </span>
              <span className="hidden text-muted-foreground sm:block">plan {formatSimClock(m.planned)}</span>
              <span className="hidden sm:block">
                {m.actual ? (
                  <>
                    {formatSimClock(m.actual)}{" "}
                    <span className={cn("text-[10px]", src.className)} title={src.title}>
                      ({src.label})
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
              <span className="justify-self-end">
                {active && !m.actual && editing?.id !== m.id && (
                  <Button size="xs" variant="ghost" onClick={() => setEditing({ id: m.id, value: toWarsawInput(simNow ?? m.planned) })} data-testid={`confirm-${m.kind}`}>
                    <Check /> Potwierdź
                  </Button>
                )}
                {active && m.actual && m.source.startsWith("agent") && editing?.id !== m.id && (
                  <Button size="xs" variant="ghost" onClick={() => setEditing({ id: m.id, value: toWarsawInput(m.actual!) })} title="Popraw datę odczytaną z maila agenta">
                    <PenLine /> Popraw
                  </Button>
                )}
              </span>
              {editing?.id === m.id && (
                <div className="col-span-full flex flex-wrap items-center gap-2 pl-4">
                  <label className="flex items-center gap-1.5">
                    Kiedy (czas polski)
                    <Input type="datetime-local" className="h-7 w-48 text-xs" value={editing.value} onChange={(e) => setEditing({ id: m.id, value: e.target.value })} />
                  </label>
                  <Button
                    size="xs"
                    onClick={() => {
                      const at = fromWarsawInput(editing.value);
                      if (!at) return toast.error("Podaj datę i godzinę — albo kliknij „Teraz”.");
                      act.mutate(
                        { action: "confirm", milestoneId: m.id, at },
                        {
                          onSuccess: () => {
                            setEditing(null);
                            toast.success("Etap potwierdzony.");
                          },
                        },
                      );
                    }}
                    disabled={act.isPending}
                  >
                    Zapisz
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => act.mutate({ action: "confirm", milestoneId: m.id, at: null }, { onSuccess: () => setEditing(null) })}>
                    Teraz
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
                    Anuluj
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[11px] text-muted-foreground">Etap potwierdzony przez spedytora (np. po telefonie) nie zostanie nadpisany odczytem z maila agenta.</p>
    </section>
  );
}

function ClientUpdates({ d, active, simNow }: { d: ShipmentDetail; active: boolean; simNow: string | undefined }) {
  const act = useShipmentAction(d.id);
  const state = d.clientUpdate.state;
  return (
    <section className="space-y-2 rounded-lg border bg-background p-3" data-testid="client-updates">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Statusy dla klienta</h3>
        {active && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                className="size-4"
                checked={d.settings.autoClientUpdates}
                onChange={(e) => act.mutate({ action: "settings", values: { autoClientUpdates: e.target.checked } })}
                data-testid="auto-updates"
              />
              Wysyłaj automatycznie
            </label>
            <label className="flex items-center gap-1.5">
              co
              <select className={select} value={d.settings.clientEveryHours} onChange={(e) => act.mutate({ action: "settings", values: { clientEveryHours: Number(e.target.value) } })} aria-label="Jak często status dla klienta">
                {[...new Set([...RHYTHMS, d.settings.clientEveryHours])]
                  .sort((a, b) => a - b)
                  .map((h) => (
                    <option key={h} value={h}>
                      {h} h
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
      </div>
      {active && d.clientUpdate.next && (
        <p className="flex flex-wrap items-center gap-2 text-xs">
          <span>
            Następny status: <strong>{when(d.clientUpdate.next)}</strong> <span className="text-muted-foreground">({relative(d.clientUpdate.next, simNow)})</span>
          </span>
          {state !== "ok" && !d.settings.autoClientUpdates && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", CLIENT_STATE[state].className)}>{CLIENT_STATE[state].label}</span>}
          {d.settings.autoClientUpdates && <span className="text-ai">AI wyśle go samo — szkic z faktów, z blokadą danych agenta i kwot.</span>}
        </p>
      )}
      {d.draft ? (
        <DraftBox key={d.draft.id} shipmentId={d.id} draft={d.draft} recipient={d.contact?.name ?? "klient"} />
      ) : (
        d.status !== "anulowana" && (
          <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "draftUpdate" })} disabled={act.isPending || !d.contact} data-testid="draft-update">
            <Sparkles /> Przygotuj status
          </Button>
        )
      )}
      {d.clientThread.length > 0 && (
        <ul className="space-y-1.5">
          {[...d.clientThread].reverse().map((m) => (
            <li key={m.id} className="rounded-md border bg-ok-soft/20 p-2 text-xs">
              <div className="mb-1 flex flex-wrap justify-between gap-2 text-muted-foreground">
                <span>
                  <strong className="text-foreground">{m.subject}</strong>
                  {m.kind === "shipment_update_auto" && <span className="ml-1.5 text-ai">automatycznie{m.classifiedBy === "ai" ? " · AI" : " · szablon"}</span>}
                </span>
                <span>{formatSimClock(m.atSim)}</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DraftBox({ shipmentId, draft, recipient }: { shipmentId: string; draft: NonNullable<ShipmentDetail["draft"]>; recipient: string }) {
  const act = useShipmentAction(shipmentId);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  return (
    <div className="space-y-2 rounded-md border border-ai/40 bg-ai-soft/30 p-2" data-testid="update-draft">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Szkic dla: {recipient}</span>
        <span className="text-muted-foreground">{draft.classifiedBy === "ai" ? "✦ napisało AI z faktów" : "z szablonu (AI niedostępne)"}</span>
      </div>
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Temat" className="h-8 text-sm" />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} aria-label="Treść" rows={9} className="text-sm" />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => act.mutate({ action: "sendUpdate", draftId: draft.id, subject, body }, { onSuccess: () => toast.success("Wysłano (w demo wiadomość zostaje w aplikacji).") })}
          disabled={act.isPending}
          data-testid="send-update"
        >
          <Send /> Wyślij do klienta
        </Button>
        <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: "discardUpdate", draftId: draft.id })} disabled={act.isPending}>
          <Trash2 /> Odrzuć
        </Button>
      </div>
    </div>
  );
}

function AgentSection({ d, active, simNow }: { d: ShipmentDetail; active: boolean; simNow: string | undefined }) {
  const act = useShipmentAction(d.id);
  const s = d.schedule;
  return (
    <section className="space-y-2 rounded-lg border bg-background p-3" data-testid="agent-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Agent: prośby o status</h3>
        {active && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5">
              Pytaj co
              <select className={select} value={d.settings.agentEveryHours} onChange={(e) => act.mutate({ action: "settings", values: { agentEveryHours: Number(e.target.value) } })} aria-label="Jak często pytać agenta">
                {[...new Set([...RHYTHMS, d.settings.agentEveryHours])]
                  .sort((a, b) => a - b)
                  .map((h) => (
                    <option key={h} value={h}>
                      {h} h
                    </option>
                  ))}
              </select>
            </label>
            <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "askAgent" }, { onSuccess: () => toast.success("Prośba o status wysłana.") })} disabled={act.isPending} data-testid="ask-agent">
              <MailQuestion /> Zapytaj teraz
            </Button>
          </div>
        )}
      </div>
      {active && (
        <p className="text-xs text-muted-foreground">
          {d.agent.awaiting
            ? `Czekamy na odpowiedź${s.lastAgentRequest ? ` od ${when(s.lastAgentRequest)}` : ""}.${s.reminderDue ? ` Przypomnienie pójdzie samo ${when(s.reminderDue)}.` : d.agent.reminded ? " Przypomnienie wysłane." : ""}`
            : s.nextAgentRequest
              ? `Następne zapytanie: ${when(s.nextAgentRequest)} (${relative(s.nextAgentRequest, simNow)}) — wcześniej, jeśli planowany etap minie bez wieści.`
              : ""}
        </p>
      )}
      <ul className="space-y-1.5">
        {d.agentThread.map((m) => (
          <li key={m.id} className={cn("rounded-md border p-2 text-xs", m.direction === "out" ? "bg-muted/30" : "bg-background")}>
            <div className="mb-1 flex flex-wrap justify-between gap-2 text-muted-foreground">
              <span>
                <strong className="text-foreground">{m.direction === "out" ? (m.sentBy === "dispatcher" ? "My (ręcznie)" : "My (automat)") : (d.agentInfo?.contactName ?? "Agent")}</strong> · {m.subject}
              </span>
              <span>{formatSimClock(m.atSim)}</span>
            </div>
            <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
            {m.reading && (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t pt-1.5 text-[11px]" data-testid="agent-reading">
                <span className={m.classifiedBy === "ai" ? "text-ai" : "text-muted-foreground"}>{m.classifiedBy === "ai" ? "✦ AI odczytało:" : "Odczyt regułami:"}</span>
                {m.reading.events.map((e) => (
                  <span key={`${e.kind}${e.at}`} className="rounded bg-muted px-1 py-0.5">
                    {EVENT_LABEL[e.kind] ?? e.kind} {formatSimClock(e.at)}
                  </span>
                ))}
                {m.reading.eta && <span className="rounded bg-muted px-1 py-0.5">ETA {formatSimClock(m.reading.eta)}</span>}
                {m.reading.delayReason && <span className="rounded bg-warn-soft px-1 py-0.5 text-warn">{m.reading.delayReason}</span>}
                {m.reading.events.length === 0 && !m.reading.eta && <span className="text-muted-foreground">nic konkretnego — przeczytaj sam</span>}
              </p>
            )}
          </li>
        ))}
        {d.agentThread.length === 0 && <li className="text-xs text-muted-foreground">Jeszcze nie pytaliśmy agenta o tę przesyłkę.</li>}
      </ul>
    </section>
  );
}
