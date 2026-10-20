"use client";

import Link from "next/link";
import { TZDate } from "@date-fns/tz";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SNAPSHOT_KEY, useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatWarsaw, WARSAW } from "@/lib/format";
import type { CatalogClient } from "@/app/api/catalog/route";
import type { ExtractedOrder } from "@/domain/email-rules";
import type { DraftOrderView } from "@/server/inbox/views";

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

/** "2026-10-15T08:00" in Warsaw time → ISO string. */
export function warsawLocalToIso(value: string): string {
  const [date, time] = value.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, WARSAW).getTime()).toISOString();
}

function localAt(baseMs: number, dayOffset: number, hour: number) {
  const base = new TZDate(baseMs, WARSAW);
  const t = new TZDate(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, WARSAW);
  return formatWarsaw(t.getTime(), "yyyy-MM-dd'T'HH:mm");
}

const toLocal = (iso: string | null | undefined) => (iso ? formatWarsaw(iso, "yyyy-MM-dd'T'HH:mm") : undefined);

type Prefill = {
  clientId: string;
  pickupPointId: string;
  deliveryPointId: string;
  times: Record<string, string>;
  pallets?: number;
  kg?: number;
  reefer: boolean;
  adr: boolean;
  refs: string;
  notes: string;
};

function prefillFrom(draft?: DraftOrderView | null, fromEmail?: EmailSource | null): Prefill | null {
  if (draft) {
    const v = draft.values;
    return {
      clientId: v.clientId,
      pickupPointId: v.pickupPointId,
      deliveryPointId: v.deliveryPointId,
      times: { pickupFrom: toLocal(v.pickupFrom)!, pickupTo: toLocal(v.pickupTo)!, deliveryFrom: toLocal(v.deliveryFrom)!, deliveryTo: toLocal(v.deliveryTo)! },
      pallets: v.cargoPallets,
      kg: v.cargoKg,
      reefer: v.bodyRequired === "chlodnia",
      adr: v.adrRequired,
      refs: v.references.join(", "),
      notes: v.notes,
    };
  }
  if (fromEmail) {
    const e = fromEmail.extracted;
    const times = Object.fromEntries(
      (
        [
          ["pickupFrom", e?.pickup_from],
          ["pickupTo", e?.pickup_to],
          ["deliveryFrom", e?.delivery_from],
          ["deliveryTo", e?.delivery_to],
        ] as const
      )
        .filter(([, v]) => v)
        .map(([k, v]) => [k, toLocal(v)!]),
    );
    return {
      clientId: fromEmail.clientId,
      pickupPointId: e?.pickup_point_id ?? "",
      deliveryPointId: e?.delivery_point_id ?? "",
      times,
      pallets: e?.pallets ?? undefined,
      kg: e?.kg ?? undefined,
      reefer: e?.reefer ?? false,
      adr: e?.adr ?? false,
      refs: e?.references.join(", ") ?? "",
      notes: e?.notes ?? "",
    };
  }
  return null;
}

export type EmailSource = { messageId: string; clientId: string; extracted: ExtractedOrder | null };

/**
 * Order form. With `draft` it corrects and approves an e-mail draft; with
 * `fromEmail` it creates an order from an incomplete e-mail (prefilled).
 */
export function NewOrderDialog({
  open,
  onOpenChange,
  draft,
  fromEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft?: DraftOrderView | null;
  fromEmail?: EmailSource | null;
}) {
  const { data: snapshot } = useSnapshot();
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => getJson<{ clients: CatalogClient[] }>("/api/catalog"), enabled: open && Boolean(snapshot) });
  const queryClient = useQueryClient();
  const [prefill] = useState(() => prefillFrom(draft, fromEmail));
  const [clientId, setClientId] = useState(prefill?.clientId ?? "");
  const [pickupPointId, setPickup] = useState(prefill?.pickupPointId ?? "");
  const [deliveryPointId, setDelivery] = useState(prefill?.deliveryPointId ?? "");
  const [times, setTimes] = useState<Record<string, string>>(prefill?.times ?? {});
  const [error, setError] = useState<string | null>(null);
  const client = catalog.data?.clients.find((c) => c.id === clientId);
  const simMs = snapshot ? new Date(snapshot.simNow).getTime() : 0;
  const defaults = {
    pickupFrom: localAt(simMs, 1, 8),
    pickupTo: localAt(simMs, 1, 10),
    deliveryFrom: localAt(simMs, 1, 14),
    deliveryTo: localAt(simMs, 1, 17),
  };
  const time = (k: keyof typeof defaults) => times[k] ?? defaults[k];

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      draft
        ? postJson<{ number: string }>(`/api/orders/${draft.id}/draft`, { action: "approve", values: body })
        : postJson<{ number: string }>("/api/orders", fromEmail ? { ...body, sourceMessageId: fromEmail.messageId } : body),
    onSuccess: (r) => {
      toast.success(draft ? `${r.number} zatwierdzone — przydziel je kierowcy` : `Zlecenie ${r.number} założone — przydziel je kierowcy`);
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: ["inbox-thread"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      onOpenChange(false);
      setClientId("");
      setPickup("");
      setDelivery("");
      setTimes({});
    },
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!clientId || !pickupPointId || !deliveryPointId) {
      setError("Wybierz klienta oraz punkty załadunku i rozładunku.");
      return;
    }
    const pallets = Number(form.get("pallets"));
    const kg = Number(form.get("kg"));
    if (!Number.isInteger(pallets) || pallets < 1 || !Number.isInteger(kg) || kg < 1) {
      setError("Podaj liczbę palet i wagę w kilogramach.");
      return;
    }
    setError(null);
    create.mutate({
      clientId,
      pickupPointId,
      deliveryPointId,
      pickupFrom: warsawLocalToIso(time("pickupFrom")),
      pickupTo: warsawLocalToIso(time("pickupTo")),
      deliveryFrom: warsawLocalToIso(time("deliveryFrom")),
      deliveryTo: warsawLocalToIso(time("deliveryTo")),
      cargoPallets: pallets,
      cargoKg: kg,
      bodyRequired: form.get("reefer") ? "chlodnia" : null,
      adrRequired: Boolean(form.get("adr")),
      references: String(form.get("refs") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      notes: String(form.get("notes") ?? ""),
    });
  }

  const pointHint = (id: string) => {
    const p = client?.points.find((x) => x.id === id);
    if (!p) return null;
    const text = [p.address, p.openingHours, p.requirements, p.notes].filter(Boolean).join(" · ");
    return <p className="text-xs text-muted-foreground">{text}</p>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{draft ? `Szkic ${draft.number} z maila — popraw i zatwierdź` : fromEmail ? "Zlecenie z maila klienta" : "Nowe zlecenie"}</DialogTitle>
          <DialogDescription>
            Punkty pochodzą z książki punktów klienta — razem z godzinami i uwagami trafią do SMS-a dla kierowcy. Nowego klienta albo punkt dodasz w module{" "}
            <Link href="/klienci" className="underline">
              Klienci
            </Link>
            .
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" data-testid="new-order-form">
          <div className="grid gap-1.5">
            <Label htmlFor="client">Klient</Label>
            <select
              id="client"
              className={selectClass}
              value={clientId}
              disabled={Boolean(prefill)}
              onChange={(e) => {
                setClientId(e.target.value);
                setPickup("");
                setDelivery("");
              }}
            >
              <option value="">Wybierz klienta…</option>
              {catalog.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isKey ? " (kluczowy)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pickup">Załadunek</Label>
              <select id="pickup" className={selectClass} value={pickupPointId} onChange={(e) => setPickup(e.target.value)} disabled={!client}>
                <option value="">Wybierz punkt…</option>
                {client?.points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.city})
                  </option>
                ))}
              </select>
              {pointHint(pickupPointId)}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="delivery">Rozładunek</Label>
              <select id="delivery" className={selectClass} value={deliveryPointId} onChange={(e) => setDelivery(e.target.value)} disabled={!client}>
                <option value="">Wybierz punkt…</option>
                {client?.points
                  .filter((p) => p.id !== pickupPointId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.city})
                    </option>
                  ))}
              </select>
              {pointHint(deliveryPointId)}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {(
              [
                ["pickupFrom", "Załadunek od"],
                ["pickupTo", "Załadunek do"],
                ["deliveryFrom", "Rozładunek od"],
                ["deliveryTo", "Rozładunek do"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="grid gap-1.5">
                <Label htmlFor={key}>{label}</Label>
                <Input id={key} type="datetime-local" value={time(key)} onChange={(e) => setTimes((t) => ({ ...t, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="pallets">Palety</Label>
              <Input id="pallets" name="pallets" type="number" min={1} max={33} defaultValue={prefill ? prefill.pallets : 10} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="kg">Waga (kg)</Label>
              <Input id="kg" name="kg" type="number" min={1} max={24000} defaultValue={prefill ? prefill.kg : 4000} />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="reefer" className="size-4" defaultChecked={prefill?.reefer} /> Chłodnia
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="adr" className="size-4" defaultChecked={prefill?.adr} /> ADR
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="refs">Numery referencyjne</Label>
              <Input id="refs" name="refs" placeholder="LW-5512, PO-2207" defaultValue={prefill?.refs} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="notes">Uwagi do zlecenia</Label>
              <Textarea id="notes" name="notes" rows={1} maxLength={500} placeholder="Towar delikatny, nie piętrować" defaultValue={prefill?.notes} />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Anuluj
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {draft ? "Zatwierdź szkic" : "Załóż zlecenie"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
