"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";
import type { DamageCaseView } from "@/server/documents/damage";

/**
 * "Asystent szkód" on a CMR with a consignee's remark: one click prepares the case — what kind of
 * reservation it is, what to do in which order, and a draft e-mail to the client waiting in Skrzynka.
 */
export function DamagePanel({ documentId, damage, onChanged }: { documentId: string; damage: DamageCaseView | null; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const url = `/api/documents/${encodeURIComponent(documentId)}`;
  const prepare = useMutation({
    mutationFn: () => postJson<{ damage: DamageCaseView }>(url, { action: "damage" }),
    onSuccess: () => {
      toast.success("Zgłoszenie szkody przygotowane. Szkic maila do klienta czeka w Skrzynce.");
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const step = useMutation({
    mutationFn: (input: { stepId: string; done: boolean }) => postJson(url, { action: "damage_step", ...input }),
    onSuccess: onChanged,
    onError: (e) => toast.error(e.message),
  });

  if (!damage) {
    return (
      <section className="space-y-2 rounded-md border border-warn/50 bg-warn-soft/50 p-2" data-testid="damage-panel">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold">
          <ShieldAlert className="size-4 text-warn" aria-hidden /> Zastrzeżenie odbiorcy
        </h2>
        <p className="text-xs text-muted-foreground">Odbiorca wpisał adnotację na CMR. Asystent przygotuje listę kroków i szkic maila do klienta; nic nie zostanie wysłane bez Ciebie.</p>
        <Button size="sm" onClick={() => prepare.mutate()} disabled={prepare.isPending} data-testid="damage-prepare">
          <Sparkles /> {prepare.isPending ? "Przygotowuję…" : "Przygotuj zgłoszenie szkody"}
        </Button>
      </section>
    );
  }

  const done = damage.steps.filter((s) => s.done).length;
  return (
    <section className="space-y-2 rounded-md border border-warn/50 bg-warn-soft/50 p-2" data-testid="damage-panel">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold">
        <ShieldAlert className="size-4 text-warn" aria-hidden /> Zgłoszenie szkody: {damage.kindLabel}
        {damage.affected ? ` (${damage.affected})` : ""}
      </h2>
      <p className="text-xs">{damage.summary}</p>
      <p className="text-[11px] text-muted-foreground">
        {damage.source === "ai" ? "Rodzaj rozpoznany przez AI." : "Rodzaj rozpoznany regułami (bez AI)."} Kroki i terminy są stałe, niezależne od AI.
      </p>
      <ul className="space-y-1" aria-label={`Kroki: ${done} z ${damage.steps.length} zrobione`}>
        {damage.steps.map((s) => (
          <li key={s.id}>
            <label className="flex cursor-pointer items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5 size-3.5" checked={s.done} disabled={step.isPending} onChange={(e) => step.mutate({ stepId: s.id, done: e.target.checked })} />
              <span className={s.done ? "text-muted-foreground line-through" : undefined}>{s.text}</span>
            </label>
          </li>
        ))}
      </ul>
      {damage.mail && (
        <p className="text-xs">
          {damage.mail.state === "draft" ? "Szkic maila do klienta" : "Mail do klienta wysłany"}
          {damage.mail.state === "draft" && (damage.mailFrom === "ai" ? " (napisany przez AI)" : " (z szablonu)")}:{" "}
          <Link href={`/skrzynka?m=${damage.mail.rootId}`} className="font-medium text-brand underline" data-testid="damage-mail-link">
            otwórz w Skrzynce
          </Link>
        </p>
      )}
      <ul className="space-y-0.5 border-t pt-1.5 text-[11px] text-muted-foreground">
        {damage.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}
