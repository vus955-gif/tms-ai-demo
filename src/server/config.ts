import { isSpeed, type Speed } from "@/simulation/clock";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  get sandboxTtlHours() {
    return num("SANDBOX_TTL_HOURS", 24);
  },
  get newSandboxesPerIpPerDay() {
    return num("SANDBOXES_PER_IP_PER_DAY", 20);
  },
  get defaultSpeed(): Speed {
    const speed = num("SIM_DEFAULT_SPEED", 10);
    return isSpeed(speed) ? speed : 10;
  },
  get aiDailyBudgetUsd() {
    return num("AI_DAILY_BUDGET_USD", 2);
  },
  get aiCallsPerSandboxPerHour() {
    return num("AI_CALLS_PER_SANDBOX_PER_HOUR", 60);
  },
  /** Public address of the app, used in links sent to clients (tracking). */
  get appUrl() {
    return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  },
  get ipSalt() {
    return process.env.SANDBOX_IP_SALT || "tms-ai-demo";
  },
  /** Fixed seed: every presentation plays out the same way unless "random run" is on. */
  defaultSeed: 20261010,
  maxEventsPerTick: 500,
};
