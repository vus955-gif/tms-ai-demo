"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SNAPSHOT_KEY } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatWarsaw } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TrailerSituation } from "@/server/fleet/trailers";

const BODY: Record<string, string> = { plandeka: "plandeka", chlodnia: "chłodnia", skrzynia: "skrzynia" };
const DROP = "__drop__";

/**
 * "Przepnij naczepę": records a swap done in the yard. Only trailers standing where the
 * tractor stands can be taken; what would clash with assigned orders is shown before confirming.
 */
export function SwapTrailerDialog({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["trailer-situation", vehicleId], queryFn: () => getJson<TrailerSituation>(`/api/vehicles/${vehicleId}/trailer`) });
  const [choice, setChoice] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);
  const s = q.data;
  const chosen = choice === DROP ? (s ? { check: s.drop } : null) : s?.options.find((o) => o.id === choice);
  const warnings = chosen?.check.warnings ?? [];
  const swap = useMutation({
    mutationFn: () => postJson(`/api/vehicles/${vehicleId}/trailer`, { trailerId: choice === DROP ? null : choice, confirm: warnings.length > 0 && understood }),
    onSuccess: () => {
      toast.success(choice === DROP ? "Naczepa odpięta — zostaje na placu." : "Naczepa przepięta. Dopasowanie zleceń widzi już nową naczepę.");
      void queryClient.invalidateQueries({ queryKey: ["fleet"] });
      void queryClient.invalidateQueries({ queryKey: ["trailer-situation"] });
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const pick = (id: string) => {
    setChoice(id);
    setUnderstood(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" data-testid="swap-dialog">
        <DialogHeader>
          <DialogTitle>Przepnij naczepę{s ? ` — ${s.vehicle.plates}` : ""}</DialogTitle>
          <DialogDescription>Zapisz przepięcie, kiedy kierowca je zrobił: stara naczepa zostaje na placu, gdzie stoi ciągnik.</DialogDescription>
        </DialogHeader>
        {!s ? (
          <p className="text-sm text-muted-foreground">Wczytywanie…</p>
        ) : (
          <div className="grid gap-3 text-sm">
            <p className="rounded-md bg-muted/50 p-2 text-xs">
              Teraz: <strong>{s.current ? `${s.current.plates} (${BODY[s.current.body] ?? s.current.body})` : "bez naczepy"}</strong>
              {s.current && ` od ${formatWarsaw(s.current.since, "d.MM.yyyy HH:mm")}`}.{" "}
              {s.inProgressOrder ? `W naczepie jest ładunek zlecenia ${s.inProgressOrder}.` : s.standsAt ? `Ciągnik stoi: ${s.standsAt}.` : "Ciągnik jest w trasie."}
            </p>
            <fieldset className="grid gap-1.5" aria-label="Naczepa do przepięcia">
              {s.options.map((o) => {
                const blocked = o.check.blockers.length > 0;
                return (
                  <label key={o.id} className={cn("flex items-start gap-2 rounded-md border p-2", blocked ? "opacity-60" : "cursor-pointer hover:bg-accent/50", choice === o.id && "border-brand")}>
                    <input type="radio" name="trailer" className="mt-1" disabled={blocked} checked={choice === o.id} onChange={() => pick(o.id)} />
                    <span className="grid gap-0.5">
                      <span>
                        <strong>{o.plates}</strong> · {BODY[o.body] ?? o.body}
                        {o.adr && " · ADR"} · {o.capacityPallets} palet · stoi: {o.where}
                      </span>
                      {o.check.blockers.map((b) => (
                        <span key={b} className="text-xs text-muted-foreground">
                          {b}
                        </span>
                      ))}
                      {!blocked &&
                        o.check.warnings.map((w) => (
                          <span key={w} className="flex items-start gap-1 text-xs text-warn">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden /> {w}
                          </span>
                        ))}
                    </span>
                  </label>
                );
              })}
              {s.options.length === 0 && <p className="text-xs text-muted-foreground">Żadna naczepa nie stoi teraz wolna.</p>}
              {s.current && (
                <label className={cn("flex items-start gap-2 rounded-md border border-dashed p-2", s.drop.blockers.length ? "opacity-60" : "cursor-pointer hover:bg-accent/50", choice === DROP && "border-brand")}>
                  <input type="radio" name="trailer" className="mt-1" disabled={s.drop.blockers.length > 0} checked={choice === DROP} onChange={() => pick(DROP)} />
                  <span className="grid gap-0.5">
                    <span>Odepnij naczepę — ciągnik jedzie bez naczepy</span>
                    {s.drop.blockers.map((b) => (
                      <span key={b} className="text-xs text-muted-foreground">
                        {b}
                      </span>
                    ))}
                    {s.drop.blockers.length === 0 &&
                      s.drop.warnings.map((w) => (
                        <span key={w} className="flex items-start gap-1 text-xs text-warn">
                          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden /> {w}
                        </span>
                      ))}
                  </span>
                </label>
              )}
            </fieldset>
            {warnings.length > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} data-testid="swap-understood" />
                Rozumiem ostrzeżenia — zlecenia, których nowa naczepa nie obsłuży, przydzielę innemu kierowcy.
              </label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => swap.mutate()} disabled={!choice || swap.isPending || (warnings.length > 0 && !understood)} data-testid="swap-confirm">
            {choice === DROP ? "Odepnij" : "Przepnij"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
