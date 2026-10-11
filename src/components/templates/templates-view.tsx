"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SNAPSHOT_KEY, useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatTime, formatWarsaw } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WEEKDAY_SHORT, type ForecastState } from "@/domain/recurring";
import type { PlannedOrder, TemplateView } from "@/server/templates/templates";
import { TemplateDialog } from "./template-dialog";

const FORECAST: Record<ForecastState, { label: string; className: string }> = {
  zdazy: { label: "zdąży", className: "bg-ok-soft text-ok" },
  ryzyko: { label: "ryzyko", className: "bg-warn-soft text-warn" },
  brak_kierowcy: { label: "brak kierowcy", className: "bg-bad-soft text-bad" },
};

const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function TemplatesView() {
  const { data: snapshot } = useSnapshot();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<TemplateView | "new" | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const q = useQuery({
    queryKey: ["templates", snapshot?.simNow],
    queryFn: () => getJson<{ templates: TemplateView[]; plan: PlannedOrder[] }>("/api/templates"),
    enabled: Boolean(snapshot),
    placeholderData: (p) => p,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["templates"] });
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
  };
  const toggle = useMutation({
    mutationFn: (t: TemplateView) => postJson(`/api/templates/${t.id}`, { action: "active", active: !t.active }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (t: TemplateView) => postJson(`/api/templates/${t.id}`, { action: "delete" }),
    onSuccess: () => {
      toast.success("Szablon usunięty.");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const create = useMutation({
    mutationFn: (keys: string[]) => postJson<{ created: string[] }>("/api/templates/plan", { keys }),
    onSuccess: (r) => {
      toast.success(r.created.length ? `Utworzono ${r.created.length}: ${r.created.join(", ")} — czekają w Zleceniach na przydział.` : "Nic nowego do utworzenia.");
      setSelected(null);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const data = q.data;
  const open = (data?.plan ?? []).filter((p) => !p.orderNumber);
  const chosen = selected ?? new Set(open.map((p) => p.key));

  return (
    <div className="grid h-full min-h-0 grid-cols-[360px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h1 className="text-sm font-semibold">Szablony zleceń stałych</h1>
          <Button size="sm" variant="outline" onClick={() => setEditing("new")} data-testid="new-template">
            <Plus /> Nowy
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="template-list">
          {data?.templates.map((t) => (
            <li key={t.id} className={cn("border-b px-3 py-2", !t.active && "opacity-60")} data-testid={`template-${t.id}`}>
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="text-left text-sm font-medium hover:underline" onClick={() => setEditing(t)}>
                  {t.name}
                </button>
                <button type="button" onClick={() => remove.mutate(t)} className="text-muted-foreground hover:text-bad" aria-label={`Usuń szablon ${t.name}`}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="text-xs text-muted-foreground">
                {t.clientName} · {t.route}
              </div>
              <div className="text-xs">
                {t.weekdays.map((d) => WEEKDAY_SHORT[d]).join(", ")} · załadunek {hm(t.pickupFromMin)}–{hm(t.pickupToMin)} · rozładunek {t.deliveryDayOffset ? `+${t.deliveryDayOffset} d ` : ""}
                {hm(t.deliveryFromMin)}–{hm(t.deliveryToMin)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t.cargoPallets} palet · {t.cargoKg.toLocaleString("pl-PL")} kg{t.bodyRequired === "chlodnia" ? " · chłodnia" : ""}
              </div>
              <label className="mt-1 flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={t.active} onChange={() => toggle.mutate(t)} /> aktywny
              </label>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-h-0 overflow-y-auto p-4" data-testid="week-plan">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-base font-semibold">
              <CalendarClock className="size-4" /> Paczka na najbliższy tydzień
            </h2>
            <p className="text-xs text-muted-foreground">Prognoza z tych samych reguł co „klocki”: czas jazdy, okna, pojemność, chłodnia, kartoteka floty i terminarz. Każde zlecenie liczone osobno.</p>
          </div>
          <Button onClick={() => create.mutate([...chosen])} disabled={chosen.size === 0 || create.isPending} data-testid="create-planned">
            Utwórz zaznaczone ({chosen.size})
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5" />
                <th className="px-2 py-1.5">Dzień</th>
                <th className="px-2 py-1.5">Szablon</th>
                <th className="px-2 py-1.5">Okna</th>
                <th className="px-2 py-1.5">Prognoza</th>
              </tr>
            </thead>
            <tbody>
              {data?.plan.map((p) => (
                <tr key={p.key} className="border-b align-top" data-testid={`plan-${p.key}`}>
                  <td className="px-2 py-1.5">
                    {p.orderNumber ? null : (
                      <input
                        type="checkbox"
                        checked={chosen.has(p.key)}
                        aria-label={`Utwórz ${p.templateName} ${p.date}`}
                        onChange={(e) => {
                          const next = new Set(chosen);
                          if (e.target.checked) next.add(p.key);
                          else next.delete(p.key);
                          setSelected(next);
                        }}
                      />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 capitalize">{formatWarsaw(p.pickupFrom, "EEEEEE d.MM")}</td>
                  <td className="px-2 py-1.5">{p.templateName}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                    {formatTime(p.pickupFrom)}–{formatTime(p.pickupTo)} → {formatTime(p.deliveryFrom)}–{formatTime(p.deliveryTo)}
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {p.orderNumber ? (
                      <span className="rounded bg-muted px-1.5 py-0.5">{p.orderNumber} utworzone</span>
                    ) : (
                      <>
                        <span className={cn("rounded px-1.5 py-0.5 font-medium", FORECAST[p.forecast].className)}>{FORECAST[p.forecast].label}</span>
                        {p.bestDriver && (
                          <span className="ml-1.5">
                            {p.bestDriver} ({p.bestPlates})
                          </span>
                        )}
                        <div className="mt-0.5 text-muted-foreground">{p.reason}</div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.plan.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-sm text-muted-foreground">
                    Brak aktywnych szablonów na najbliższy tydzień.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!data && !q.isError && <p className="text-sm text-muted-foreground">Liczę prognozę…</p>}
        {q.isError && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Nie udało się policzyć paczki: {q.error.message}
          </p>
        )}
      </section>
      {editing && <TemplateDialog key={editing === "new" ? "new" : editing.id} template={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}
