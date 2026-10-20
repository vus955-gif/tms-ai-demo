"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getJson, postJson } from "@/lib/api";
import type { RoadRate } from "@/db/schema";
import type { SalesSettingsView } from "@/server/sales/views";
import { MODE } from "./labels";

const SETTINGS_KEY = ["sales-settings"] as const;

export function SalesSettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => getJson<SalesSettingsView>("/api/sales/settings") });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] sm:max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ustawienia Sprzedaży</DialogTitle>
          <DialogDescription>Automat potwierdzeń i zapytań, marża domyślna, stawki drogowe i lista zaufanych agentów (fikcyjnych).</DialogDescription>
        </DialogHeader>
        {settings.data ? <SettingsForm initial={settings.data} onClose={onClose} /> : <p className="text-sm text-muted-foreground">Wczytywanie…</p>}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ initial, onClose }: { initial: SalesSettingsView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [autoSend, setAutoSend] = useState(initial.autoSend);
  const [margin, setMargin] = useState(String(initial.defaultMarginPct));
  const [adr, setAdr] = useState(String(initial.adrSurchargePct));
  const [reefer, setReefer] = useState(String(initial.reeferSurchargePct));
  const [rates, setRates] = useState<RoadRate[]>(initial.roadRates);
  const num = (v: string) => Number(v.replace(",", "."));
  const save = useMutation({
    mutationFn: () =>
      postJson<SalesSettingsView>("/api/sales/settings", {
        settings: { autoSend, defaultMarginPct: num(margin), adrSurchargePct: num(adr), reeferSurchargePct: num(reefer), roadRates: rates },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY, data);
      toast.success("Ustawienia zapisane.");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (v: { agentId: string; active: boolean }) => postJson<SalesSettingsView>("/api/sales/settings", v),
    onSuccess: (data) => queryClient.setQueryData(SETTINGS_KEY, data),
    onError: (e) => toast.error(e.message),
  });
  const agents = (queryClient.getQueryData<SalesSettingsView>(SETTINGS_KEY) ?? initial).agents;
  const setRate = (i: number, key: keyof RoadRate, value: string) => setRates((list) => list.map((r, j) => (j === i ? { ...r, [key]: key === "label" || key === "kind" ? value : num(value) } : r)));

  return (
    <div className="grid gap-4 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 size-4" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} data-testid="auto-send" />
        <span>
          <strong>Automatycznie</strong> wysyłaj klientowi potwierdzenie i zapytania do agentów, gdy dane są kompletne.
          <span className="block text-xs text-muted-foreground">Wyłączone: wycena czeka na „Wyślij potwierdzenie i zapytania”.</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-xs">
          Marża domyślna %<Input value={margin} onChange={(e) => setMargin(e.target.value)} className="h-8 w-24" />
        </label>
        <label className="grid gap-1 text-xs">
          Dopłata ADR %<Input value={adr} onChange={(e) => setAdr(e.target.value)} className="h-8 w-24" />
        </label>
        <label className="grid gap-1 text-xs">
          Dopłata chłodnia %<Input value={reefer} onChange={(e) => setReefer(e.target.value)} className="h-8 w-24" />
        </label>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stawki drogowe (fikcyjne)</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">Pojazd</th>
              <th>PLN/km</th>
              <th>min PLN</th>
              <th>EUR/km</th>
              <th>min EUR</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r, i) => (
              <tr key={r.kind}>
                <td className="py-1 pr-2">{r.label}</td>
                {(["perKmPln", "minPln", "perKmEur", "minEur"] as const).map((k) => (
                  <td key={k} className="pr-2">
                    <Input value={String(r[k])} onChange={(e) => setRate(i, k, e.target.value)} className="h-7 w-20" aria-label={`${r.label} ${k}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Zaufani agenci</h3>
        <ul className="divide-y rounded-md border">
          {agents.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
              <span>
                <strong>{a.company}</strong> · {a.contactName} · {a.modes.map((m) => MODE[m].label).join(", ")} · {a.regions}
              </span>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={a.active} onChange={(e) => toggle.mutate({ agentId: a.id, active: e.target.checked })} /> aktywny
              </label>
            </li>
          ))}
        </ul>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Anuluj
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="save-sales-settings">
          Zapisz
        </Button>
      </DialogFooter>
    </div>
  );
}
