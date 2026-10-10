/**
 * When to remind a driver who has not answered an order SMS, and when to alert
 * the dispatcher (spec §7.5): X = Y = 20 minutes, or 10 when loading starts
 * within two hours.
 */
export const ESCALATION_DEFAULT_MIN = 20;
export const ESCALATION_URGENT_MIN = 10;
export const URGENT_WITHIN_MIN = 120;

export function escalationTimes(sentAtMs: number, pickupFromMs: number): { reminderMs: number; alertMs: number } {
  const urgent = pickupFromMs - sentAtMs < URGENT_WITHIN_MIN * 60_000;
  const step = (urgent ? ESCALATION_URGENT_MIN : ESCALATION_DEFAULT_MIN) * 60_000;
  return { reminderMs: sentAtMs + step, alertMs: sentAtMs + 2 * step };
}
