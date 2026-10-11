"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatWarsaw } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AbsenceKind } from "@/db/schema";
import type { CalendarView as Calendar } from "@/server/fleet/views";

const ABSENCE_STYLE: Record<AbsenceKind, string> = {
  urlop: "bg-ai-soft text-ai",
  l4: "bg-bad-soft text-bad",
  szkolenie: "bg-brand/10 text-brand",
  badania: "bg-warn-soft text-warn",
  wolne: "bg-muted text-muted-foreground",
};
const KINDS: { id: AbsenceKind; label: string }[] = [
  { id: "urlop", label: "urlop" },
  { id: "l4", label: "zwolnienie lekarskie" },
  { id: "szkolenie", label: "szkolenie" },
  { id: "badania", label: "badania" },
  { id: "wolne", label: "dzień wolny" },
];
const DAY = 86_400_000;

export function CalendarView() {
  const { data: snapshot } = useSnapshot();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ["calendar", offset, snapshot?.simNow],
    queryFn: () => getJson<Calendar>(`/api/calendar?offset=${offset}`),
    enabled: Boolean(snapshot),
    placeholderData: (p) => p,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    void queryClient.invalidateQueries({ queryKey: ["matching"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => postJson(`/api/calendar/${id}`, { action: "remove" }),
    onSuccess: () => {
      toast.success("Nieobecność usunięta.");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const data = q.data;

  return (
    <div className="flex flex-col gap-4 p-5" data-testid="calendar-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Terminarz kierowców</h1>
          <p className="text-sm text-muted-foreground">Urlopy, zwolnienia, szkolenia i zlecenia w tygodniu. Nieobecność w czasie zlecenia wyklucza kierowcę z „klocków”.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="outline" onClick={() => setOffset((o) => o - 7)} aria-label="Poprzedni tydzień">
            <ChevronLeft />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOffset(0)}>
            Ten tydzień
          </Button>
          <Button size="icon-sm" variant="outline" onClick={() => setOffset((o) => o + 7)} aria-label="Następny tydzień">
            <ChevronRight />
          </Button>
        </div>
      </div>
      {data && <AbsenceForm drivers={data.drivers.map((d) => ({ id: d.id, name: d.name }))} defaultDay={data.days[0]} onAdded={refresh} />}
      {data && (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-full min-w-[900px] border-collapse text-xs" data-testid="calendar-grid">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="w-44 px-2 py-1.5 font-medium">Kierowca</th>
                {data.days.map((d) => (
                  <th key={d} className="px-2 py-1.5 font-medium capitalize">
                    {formatWarsaw(d, "EEEEEE d.MM")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.drivers.map((dr) => (
                <tr key={dr.id} className="border-b align-top" data-testid={`calendar-${dr.id}`}>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{dr.name}</div>
                    <div className="text-[11px] text-muted-foreground">{dr.plates}</div>
                  </td>
                  {data.days.map((d) => {
                    const start = new Date(d).getTime();
                    const end = start + DAY;
                    const abs = dr.absences.filter((a) => new Date(a.from).getTime() < end && new Date(a.to).getTime() > start);
                    const ords = dr.orders.filter((o) => new Date(o.from).getTime() < end && new Date(o.to).getTime() > start);
                    return (
                      <td key={d} className="space-y-1 px-1 py-1">
                        {abs.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            title={`${a.label}${a.note ? ` — ${a.note}` : ""} (kliknij, aby usunąć)`}
                            onClick={() => remove.mutate(a.id)}
                            className={cn("flex w-full items-center justify-between rounded px-1.5 py-0.5 text-left", ABSENCE_STYLE[a.kind])}
                          >
                            {a.label}
                            <X className="size-3 opacity-60" />
                          </button>
                        ))}
                        {ords.map((o) => (
                          <div key={o.id} className="rounded border border-ok/40 bg-ok-soft px-1.5 py-0.5 text-ok" title={`${o.number}: ${formatWarsaw(o.from, "d.MM HH:mm")} – ${formatWarsaw(o.to, "d.MM HH:mm")}`}>
                            {o.number}
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!data && <p className="text-sm text-muted-foreground">Wczytywanie…</p>}
    </div>
  );
}

function AbsenceForm({ drivers, defaultDay, onAdded }: { drivers: { id: string; name: string }[]; defaultDay: string; onAdded: () => void }) {
  const day = formatWarsaw(defaultDay, "yyyy-MM-dd");
  const [driverId, setDriverId] = useState("");
  const [kind, setKind] = useState<AbsenceKind>("urlop");
  const [from, setFrom] = useState(day);
  const [to, setTo] = useState(day);
  const add = useMutation({
    mutationFn: () => postJson("/api/calendar", { driverId, kind, from, to, note: "" }),
    onSuccess: () => {
      toast.success("Nieobecność dodana — „klocki” ją uwzględnią.");
      onAdded();
    },
    onError: (e) => toast.error(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (driverId) add.mutate();
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-lg border bg-background p-3 text-sm" data-testid="absence-form">
      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Kierowca</span>
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Kierowca">
          <option value="">Wybierz…</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Rodzaj</span>
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as AbsenceKind)} aria-label="Rodzaj nieobecności">
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Od</span>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8" aria-label="Od" />
      </label>
      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Do</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8" aria-label="Do" />
      </label>
      <Button size="sm" type="submit" disabled={!driverId || add.isPending} data-testid="add-absence">
        <Plus /> Dodaj nieobecność
      </Button>
    </form>
  );
}
