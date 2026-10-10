import type { SandboxContext } from "./http";
import { runTick } from "./tick/engine";

/** Brings the world up to "now", then runs a dispatcher action at that simulated time. */
export async function atCurrentTime<T>(ctx: SandboxContext, action: (simNow: Date) => Promise<T>): Promise<T> {
  const tick = await runTick(ctx.db, ctx.sandbox.id, ctx.realNow);
  return action(tick.simNow);
}
