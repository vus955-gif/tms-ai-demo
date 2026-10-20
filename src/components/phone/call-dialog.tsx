"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SNAPSHOT_KEY } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import type { ThreadDetail } from "@/server/messages/threads";

const QUICK = ["Nie odebrał(a) — spróbuję później.", "Potwierdził(a) — jedzie zgodnie z planem.", "Poda nowe ETA SMS-em.", "Oddzwoni po rozładunku."];

/**
 * "Zadzwoń": the driver's number (a tel: link opens the phone or softphone) and a note
 * from the call, saved in the driver's thread so the next person on shift sees it.
 */
export function CallDialog({ driverId, alertId, context, onClose }: { driverId: string; alertId?: string; context?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const thread = useQuery({ queryKey: ["thread", driverId], queryFn: () => getJson<ThreadDetail>(`/api/messages/${driverId}`) });
  const [note, setNote] = useState("");
  const [resolve, setResolve] = useState(Boolean(alertId));
  const save = useMutation({
    mutationFn: () => postJson(`/api/messages/${driverId}/call`, { note, alertId: alertId ?? null, resolve }),
    onSuccess: () => {
      toast.success("Notatka z rozmowy zapisana w Komunikatorze.");
      void queryClient.invalidateQueries({ queryKey: ["thread", driverId] });
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const d = thread.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="call-dialog">
        <DialogHeader>
          <DialogTitle>Zadzwoń: {d?.driverName ?? "kierowca"}</DialogTitle>
          <DialogDescription>{context ?? (d ? `${d.plates}${d.trailerPlates ? ` + ${d.trailerPlates}` : ""}` : "")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          {d && (
            <a href={`tel:${d.phone.replace(/\s/g, "")}`} className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent">
              <span className="text-lg font-semibold tabular-nums">{d.phone}</span>
              <span className="flex items-center gap-1.5 text-xs text-brand">
                <Phone className="size-4" /> Zadzwoń z telefonu
              </span>
            </a>
          )}
          <p className="text-[11px] text-muted-foreground">Demo: numer jest fikcyjny, połączenie nie wyjdzie. W firmie ten link otwiera telefon albo softphone (np. Teams).</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q} type="button" className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent" onClick={() => setNote(q)}>
                {q}
              </button>
            ))}
          </div>
          <label className="grid gap-1">
            Notatka z rozmowy
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="Co ustaliliście? Trafi do wątku kierowcy w Komunikatorze." />
          </label>
          {alertId && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={resolve} onChange={(e) => setResolve(e.target.checked)} />
              Zamknij alert po zapisaniu
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="save-call">
            Zapisz notatkę
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
