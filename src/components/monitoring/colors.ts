import type { RiskState } from "@/domain/risk";

/** Risk colours shared by the map (needs plain hex) and the lists. */
export const RISK_COLOR: Record<RiskState, string> = {
  green: "#16a34a",
  yellow: "#d97706",
  red: "#dc2626",
  gray: "#94a3b8",
};
