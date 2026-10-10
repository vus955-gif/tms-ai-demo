import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ALERT_ACTIONS, alerts, type AlertAction } from "@/db/schema";
import type { Executor } from "@/db/types";
import { runStructured } from "../run-structured";

export const AlertExplanationSchema = z.object({
  title: z.string().describe("Krótki tytuł alertu po polsku, do 80 znaków"),
  body: z.string().describe("1–2 zdania wyjaśnienia po polsku"),
  actions: z.array(z.enum(ALERT_ACTIONS)).describe("Do 3 akcji z listy, które pomogą spedytorowi"),
});
export type AlertExplanation = z.infer<typeof AlertExplanationSchema>;

const SYSTEM = `Jesteś asystentem spedytora w polskiej firmie transportowej.
Dostajesz fakty policzone przez system: czasy, okna czasowe, przepisy o czasie jazdy, zdarzenia drogowe.
Zasady:
- Nie licz niczego samodzielnie i nie zmieniaj żadnych liczb ani godzin — używaj wyłącznie podanych wartości.
- Napisz tytuł (do 80 znaków) i 1–2 rzeczowe zdania po polsku: co się dzieje, dlaczego i czym grozi.
- Bez wykrzykników, bez zwrotów grzecznościowych, bez spekulacji.
- Wybierz najwyżej 3 akcje z dozwolonej listy; tylko takie, które mają sens dla tych faktów.
  pokaz_objazd i zastosuj_objazd wybieraj tylko wtedy, gdy w faktach jest trasa objazdu.`;

/** Rewrites a template alert in plain language. Never changes the facts, only the wording. */
export async function explainAlert(opts: {
  db: Executor;
  sandboxId: string;
  alertId: string;
  simNow: Date;
  facts: Record<string, unknown>;
  fallback: AlertExplanation;
  allowedActions: AlertAction[];
}) {
  const outcome = await runStructured({
    fn: "explainAlert",
    schema: AlertExplanationSchema,
    system: SYSTEM,
    content: [
      {
        type: "text",
        text: `Fakty (JSON):\n<fakty>${JSON.stringify(opts.facts)}</fakty>\nDozwolone akcje: ${opts.allowedActions.join(", ")}`,
      },
    ],
    fallback: () => opts.fallback,
    db: opts.db,
    sandboxId: opts.sandboxId,
    simNow: opts.simNow,
    inputRef: String(opts.facts.summary ?? opts.alertId),
  });
  if (outcome.source !== "ai") return outcome;
  const value = outcome.value;
  const actions = value.actions.filter((a) => opts.allowedActions.includes(a)).slice(0, 3);
  await opts.db
    .update(alerts)
    .set({
      title: value.title.slice(0, 120),
      body: value.body.slice(0, 600),
      actions: actions.length > 0 ? actions : opts.fallback.actions,
      bodySource: "ai",
    })
    .where(and(eq(alerts.sandboxId, opts.sandboxId), eq(alerts.id, opts.alertId)));
  return outcome;
}
