"use client";

import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getJson, postJson } from "@/lib/api";
import { WEEKDAY_SHORT } from "@/domain/recurring";
import type { CatalogClient } from "@/app/api/catalog/route";
import type { TemplateView } from "@/server/templates/templates";

const select = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** "HH:MM" → minutes; anything else becomes NaN, which the server rejects with a message. */
const toMin = (v: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
/** Whole numbers only ("10,5" or "" are refused by the server instead of turning into 10 or 0). */
const toInt = (v: string) => (/^\s*\d+\s*$/.test(v) ? Number(v) : NaN);

/** Create or edit a recurring order template; points come from the client's book. */
export function TemplateDialog({ template, onClose, onSaved }: { template: TemplateView | null; onClose: () => void; onSaved: () => void }) {
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => getJson<{ clients: CatalogClient[] }>("/api/catalog") });
  const [name, setName] = useState(template?.name ?? "");
  const [clientId, setClientId] = useState(template?.clientId ?? "");
  const [pickupPointId, setPickup] = useState(template?.pickupPointId ?? "");
  const [deliveryPointId, setDelivery] = useState(template?.deliveryPointId ?? "");
  const [times, setTimes] = useState({
    pf: hm(template?.pickupFromMin ?? 360),
    pt: hm(template?.pickupToMin ?? 480),
    df: hm(template?.deliveryFromMin ?? 780),
    dt: hm(template?.deliveryToMin ?? 960),
  });
  const [offset, setOffset] = useState(template?.deliveryDayOffset ?? 0);
  const [weekdays, setWeekdays] = useState<number[]>(template?.weekdays ?? [1, 2, 3, 4, 5]);
  const [pallets, setPallets] = useState(String(template?.cargoPallets ?? 10));
  const [kg, setKg] = useState(String(template?.cargoKg ?? 4000));
  const [reefer, setReefer] = useState(template?.bodyRequired === "chlodnia");
  const [adr, setAdr] = useState(template?.adrRequired ?? false);
  const [refs, setRefs] = useState(template?.references.join(", ") ?? "");
  const [error, setError] = useState<string | null>(null);
  const client = catalog.data?.clients.find((c) => c.id === clientId);
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => (template ? postJson(`/api/templates/${template.id}`, { action: "update", values }) : postJson("/api/templates", values)),
    onSuccess: () => {
      toast.success(template ? "Szablon zapisany." : "Szablon dodany — pojawi się w paczce na tydzień.");
      onSaved();
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate({
      name,
      clientId,
      pickupPointId,
      deliveryPointId,
      pickupFromMin: toMin(times.pf),
      pickupToMin: toMin(times.pt),
      deliveryDayOffset: offset,
      deliveryFromMin: toMin(times.df),
      deliveryToMin: toMin(times.dt),
      cargoPallets: toInt(pallets),
      cargoKg: toInt(kg),
      bodyRequired: reefer ? "chlodnia" : template?.bodyRequired === "chlodnia" ? null : (template?.bodyRequired ?? null),
      adrRequired: adr,
      references: refs
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean),
      notes: template?.notes ?? "",
      weekdays,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template ? "Edycja szablonu" : "Nowy szablon zlecenia stałego"}</DialogTitle>
          <DialogDescription>
            Punkty z książki punktów klienta (nowe dodasz w module{" "}
            <Link href="/klienci" className="underline">
              Klienci
            </Link>
            ). Paczka na tydzień tworzy z szablonu zlecenia na wybrane dni.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 text-sm" data-testid="template-form">
          <label className="grid gap-1">
            Nazwa
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Agro-Pol: pasza Kutno → Gdynia" aria-label="Nazwa szablonu" />
          </label>
          <label className="grid gap-1">
            Klient
            <select className={select} value={clientId} disabled={Boolean(template)} onChange={(e) => (setClientId(e.target.value), setPickup(""), setDelivery(""))} aria-label="Klient">
              <option value="">Wybierz…</option>
              {catalog.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["Załadunek", pickupPointId, setPickup],
                ["Rozładunek", deliveryPointId, setDelivery],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label} className="grid gap-1">
                {label}
                <select className={select} value={value} onChange={(e) => set(e.target.value)} disabled={!client} aria-label={label}>
                  <option value="">Wybierz punkt…</option>
                  {client?.points.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.city})
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            {(
              [
                ["pf", "Załadunek od"],
                ["pt", "Załadunek do"],
                ["df", "Rozładunek od"],
                ["dt", "Rozładunek do"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="grid gap-1 text-xs">
                {label}
                <Input type="time" value={times[k]} onChange={(e) => setTimes((t) => ({ ...t, [k]: e.target.value }))} aria-label={label} />
              </label>
            ))}
            <label className="grid gap-1 text-xs">
              Rozładunek
              <select className={select} value={offset} onChange={(e) => setOffset(Number(e.target.value))} aria-label="Dzień rozładunku">
                <option value={0}>tego dnia</option>
                <option value={1}>następnego dnia</option>
                <option value={2}>po 2 dniach</option>
                <option value={3}>po 3 dniach</option>
              </select>
            </label>
          </div>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 text-xs text-muted-foreground">Dni tygodnia</legend>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className="flex items-center gap-1 rounded border px-2 py-1 text-xs">
                <input type="checkbox" checked={weekdays.includes(d)} onChange={(e) => setWeekdays((w) => (e.target.checked ? [...w, d] : w.filter((x) => x !== d)))} />
                {WEEKDAY_SHORT[d]}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-5">
            <label className="grid gap-1 text-xs">
              Palety
              <Input value={pallets} onChange={(e) => setPallets(e.target.value)} inputMode="numeric" aria-label="Palety" />
            </label>
            <label className="grid gap-1 text-xs">
              Waga (kg)
              <Input value={kg} onChange={(e) => setKg(e.target.value)} inputMode="numeric" aria-label="Waga (kg)" />
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs">
              <input type="checkbox" checked={reefer} onChange={(e) => setReefer(e.target.checked)} className="size-4" /> Chłodnia
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs">
              <input type="checkbox" checked={adr} onChange={(e) => setAdr(e.target.checked)} className="size-4" /> ADR
            </label>
            <label className="grid gap-1 text-xs">
              Referencje
              <Input value={refs} onChange={(e) => setRefs(e.target.value)} placeholder="AP-STAŁE" aria-label="Referencje" />
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={save.isPending} data-testid="save-template">
              Zapisz
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
