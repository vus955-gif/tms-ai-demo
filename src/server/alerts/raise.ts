import type { AlertAction } from "@/db/schema";
import { explainAlert } from "@/ai/functions/explain-alert";
import type { TickContext } from "../tick/registry";
import { openAlert, type AlertInput } from "./repository";

/**
 * Opens an alert with template text and, when someone is watching (not stale),
 * asks AI after the commit to rewrite it in plain language.
 */
export async function raiseAlert(ctx: TickContext, input: AlertInput, atSim: Date, allowedActions?: AlertAction[]) {
  const result = await openAlert(ctx.tx, ctx.sandbox.id, input, atSim);
  if (result.created && !ctx.isStale(atSim)) {
    const sandboxId = ctx.sandbox.id;
    ctx.afterCommit((db) =>
      explainAlert({
        db,
        sandboxId,
        alertId: result.id,
        simNow: atSim,
        facts: input.facts,
        fallback: { title: input.title, body: input.body, actions: input.actions },
        allowedActions: allowedActions ?? input.actions,
      }).then(() => undefined),
    );
  }
  return result;
}
