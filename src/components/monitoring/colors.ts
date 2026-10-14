import type { RiskState } from "@/domain/risk";
import type { ResolvedTheme } from "@/components/theme/theme";

/** Risk colours shared by the map (needs plain hex) and the lists; they read on both light and dark maps. */
export const RISK_COLOR: Record<RiskState, string> = {
  green: "#16a34a",
  yellow: "#d97706",
  red: "#dc2626",
  gray: "#94a3b8",
};

/** Base map styles (OpenFreeMap); both can be replaced with your own tile provider. */
export const MAP_STYLE_URL: Record<ResolvedTheme, string> = {
  light: process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron",
  dark: process.env.NEXT_PUBLIC_MAP_STYLE_DARK_URL || "https://tiles.openfreemap.org/styles/dark",
};

/** Our lines and labels on top of the base map: dark blue on light maps would vanish on dark ones. */
export function mapOverlayColors(theme: ResolvedTheme) {
  return theme === "dark"
    ? { driven: "#64748b", remaining: "#60a5fa", alternative: "#a78bfa", dotStroke: "#e2e8f0", label: "#e5e7eb", labelHalo: "#0f172a", tracking: "#6db4e3" }
    : { driven: "#94a3b8", remaining: "#1d6fa5", alternative: "#7c3aed", dotStroke: "#ffffff", label: "#1f2937", labelHalo: "#ffffff", tracking: "#0f5c8c" };
}
