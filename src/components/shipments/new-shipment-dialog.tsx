"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AGENT_EVERY_HOURS, type ShipmentMode } from "@/domain/shipments";
import { useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ShipmentFormOptions, ShipmentPrefill } from "@/server/shipments/views";
import { fromWarsawInput, MODE, toWarsawInput } from "./labels";

const select = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const DAY = 86_400_000;

type Props = { options: ShipmentFormOptions; fromQuote: string | null; onClose: () => void; onCreated: (id: string) => void };

/** "Nowa przesyłka" — by hand, or prefilled from a won sea/air/rail quote. */
export function NewShipmentDialog(props: Props) {
  const prefill = useQuery({
    queryKey: ["shipment-prefill", props.fromQuote],
    queryFn: () => getJson<ShipmentPrefill>(`/api/shipments/prefill?quote=${encodeURIComponent(props.fromQuote!)}`),
    enabled: Boolean(props.fromQuote),
    retry: false,
  });
  if (props.fromQuote && prefill.isPending) return null;
  return <ShipmentForm {...props} prefill={prefill.data ?? null} prefillError={prefill.error?.message ?? null} />;
}

function ShipmentForm({ options, onClose, onCreated, prefill, prefillError }: Props & { prefill: ShipmentPrefill | null; prefillError: string | null }) {
  const { data: snapshot } = useSnapshot();
  // The dialog opens only once the world is loaded, so the simulated "now" is known.
  const now = snapshot ? new Date(snapshot.simNow).getTime() : null;
  const [mode, setMode] = useState<ShipmentMode>(prefill?.mode ?? "sea");
  const [clientId, setClientId] = useState(prefill?.clientId ?? "");
  const [contactId, setContactId] = useState(prefill?.contactId ?? "");
  const [originId, setOriginId] = useState(prefill?.originId ?? "");
  const [destinationId, setDestinationId] = useState(prefill?.destinationId ?? "");
  const [agentId, setAgentId] = useState(prefill?.agentId ?? "");
  const [etd, setEtd] = useState(() => (now === null ? "" : toWarsawInput(new Date(Math.ceil((now + 3 * DAY) / 3_600_000) * 3_600_000).toISOString())));
  const [eta, setEta] = useState("");
  const [etaTouched, setEtaTouched] = useState(false);
  const [incoterms, setIncoterms] = useState(prefill?.incoterms ?? "");
  const [cargo, setCargo] = useState(prefill?.cargo ?? "");
  const [pieces, setPieces] = useState(prefill?.pieces ? String(prefill.pieces) : "");
  const [weight, setWeight] = useState(prefill?.weightKg ? String(prefill.weightKg) : "");
  const [volume, setVolume] = useState(prefill?.volumeCbm ? String(prefill.volumeCbm) : "");
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState<string | null>(prefillError);

  const lanes = useMemo(() => options.lanes.filter((l) => l.mode === mode), [options.lanes, mode]);
  const origins = options.places.filter((p) => lanes.some((l) => l.from === p.id));
  const destinations = options.places.filter((p) => lanes.some((l) => l.from === originId && l.to === p.id));
  const lane = lanes.find((l) => l.from === originId && l.to === destinationId);
  const agents = options.agents.filter((a) => a.modes.includes(mode));
  const contacts = options.clients.find((c) => c.id === clientId)?.contacts ?? [];

  // ETA follows ETD + typical transit until the forwarder types their own.
  const etaShown = etaTouched || !lane ? eta : (() => {
    const from = fromWarsawInput(etd);
    return from ? toWarsawInput(new Date(new Date(from).getTime() + lane.transitDays * DAY).toISOString()) : "";
  })();

  const switchMode = (m: ShipmentMode) => {
    setMode(m);
    setOriginId("");
    setDestinationId("");
    if (!options.agents.find((a) => a.id === agentId)?.modes.includes(m)) setAgentId("");
  };

  const refFields: [string, string][] = [
    ["booking", "Booking"],
    ...(mode === "air" ? ([["awb", "AWB"]] as [string, string][]) : mode === "sea" ? ([["bl", "B/L"]] as [string, string][]) : []),
    ...(mode !== "air" ? ([["container", "Kontener"]] as [string, string][]) : []),
    [mode === "sea" ? "vessel" : mode === "air" ? "flight" : "train", mode === "sea" ? "Statek / rejs" : mode === "air" ? "Lot" : "Pociąg"],
    ["clientRef", "Ref. klienta"],
  ];

  const create = useMutation({
    mutationFn: () => {
      const num = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : null);
      return postJson<{ id: string }>("/api/shipments", {
        mode,
        clientId,
        contactId,
        agentId,
        originId,
        destinationId,
        etd: fromWarsawInput(etd) ?? "",
        eta: fromWarsawInput(etaShown) ?? "",
        incoterms,
        cargo,
        pieces: num(pieces),
        weightKg: num(weight) === null ? null : Math.round(num(weight)!),
        volumeCbm: num(volume),
        // Only the fields of the chosen mode (an AWB typed before switching to sea must not reach the agent).
        refs: Object.fromEntries(Object.entries(refs).filter(([k, v]) => v.trim() && refFields.some(([key]) => key === k))),
        quoteId: prefill?.quoteId ?? null,
        autoClientUpdates: auto,
      });
    },
    onSuccess: (r) => {
      toast.success("Przesyłka utworzona — agent będzie pytany o status automatycznie.");
      onCreated(r.id);
    },
    onError: (e) => setError(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!clientId || !contactId) return setError("Wybierz klienta i osobę kontaktową.");
    if (!originId || !destinationId) return setError("Wybierz skąd i dokąd.");
    if (!agentId) return setError("Wybierz agenta.");
    if (!fromWarsawInput(etd) || !fromWarsawInput(etaShown)) return setError("Uzupełnij ETD i ETA.");
    if ([pieces, weight, volume].some((v) => v.trim() && !Number.isFinite(Number(v.replace(",", "."))))) return setError("Sztuk, waga i CBM muszą być liczbami.");
    create.mutate();
  };


  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] sm:max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{prefill ? `Nowa przesyłka z wyceny ${prefill.quoteNumber}` : "Nowa przesyłka"}</DialogTitle>
          <DialogDescription>
            Po zapisaniu system sam prosi agenta o status (co {AGENT_EVERY_HOURS[mode]} h, wcześniej, gdy planowany etap minie bez wieści) i przypomina o statusie dla klienta. Dane w demo są fikcyjne.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 text-sm" data-testid="shipment-form">
          <div className="flex gap-2" role="group" aria-label="Rodzaj transportu">
            {(Object.keys(MODE) as ShipmentMode[]).map((m) => (
              <Button key={m} type="button" size="sm" variant={mode === m ? "default" : "outline"} aria-pressed={mode === m} onClick={() => switchMode(m)} disabled={Boolean(prefill)}>
                <span aria-hidden>{MODE[m].icon}</span> {MODE[m].label}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              Klient
              <select
                className={select}
                aria-label="Klient"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setContactId(options.clients.find((c) => c.id === e.target.value)?.contacts[0]?.id ?? "");
                }}
                disabled={Boolean(prefill)}
              >
                <option value="">— wybierz —</option>
                {options.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              Osoba (dostaje statusy)
              <select className={select} aria-label="Osoba kontaktowa" value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!clientId}>
                <option value="">— wybierz —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              Skąd
              <select
                className={select}
                aria-label="Skąd"
                value={originId}
                onChange={(e) => {
                  setOriginId(e.target.value);
                  setDestinationId("");
                }}
              >
                <option value="">— wybierz —</option>
                {origins.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              Dokąd
              <select className={select} aria-label="Dokąd" value={destinationId} onChange={(e) => setDestinationId(e.target.value)} disabled={!originId}>
                <option value="">— wybierz —</option>
                {destinations.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 sm:col-span-2">
              Agent
              <select className={select} aria-label="Agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">— wybierz —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.company} ({a.regions})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              ETD — wyjazd (czas polski)
              <Input type="datetime-local" value={etd} onChange={(e) => setEtd(e.target.value)} />
            </label>
            <label className="grid gap-1">
              ETA — przybycie (czas polski)
              <Input
                type="datetime-local"
                value={etaShown}
                onChange={(e) => {
                  setEta(e.target.value);
                  setEtaTouched(true);
                }}
              />
              {lane && !etaTouched && <span className="text-[11px] text-muted-foreground">Typowy tranzyt: {lane.transitDays} dni — popraw według bookingu.</span>}
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-[80px_1fr_90px_100px_90px]">
            <label className="grid gap-1">
              Incoterms
              <Input value={incoterms} onChange={(e) => setIncoterms(e.target.value.toUpperCase().slice(0, 3))} placeholder="FOB" />
            </label>
            <label className="grid gap-1">
              Ładunek
              <Input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="1 × 40' HC, meble" maxLength={120} />
            </label>
            <label className="grid gap-1">
              Sztuk
              <Input value={pieces} onChange={(e) => setPieces(e.target.value)} inputMode="numeric" />
            </label>
            <label className="grid gap-1">
              Waga (kg)
              <Input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" />
            </label>
            <label className="grid gap-1">
              CBM
              <Input value={volume} onChange={(e) => setVolume(e.target.value)} inputMode="decimal" />
            </label>
          </div>
          <fieldset className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3">
            <legend className="px-1 text-xs text-muted-foreground">Numery (agent dostaje wszystkie poza referencją klienta)</legend>
            {refFields.map(([key, label]) => (
              <label key={key} className="grid gap-1 text-xs">
                {label}
                <Input value={refs[key] ?? ""} onChange={(e) => setRefs((r) => ({ ...r, [key]: e.target.value }))} maxLength={40} className="h-8" />
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Statusy dla klienta wysyłaj automatycznie (AI pisze z potwierdzonych faktów; nazwy agenta i kwoty są blokowane)
          </label>
          {error && (
            <p role="alert" className={cn("text-sm text-destructive")}>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={create.isPending} data-testid="create-shipment">
              Utwórz przesyłkę
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
