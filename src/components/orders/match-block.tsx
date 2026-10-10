import { cn } from "@/lib/utils";
import type { MatchView } from "@/server/orders/board";

export const TIER_LABEL: Record<MatchView["tier"], string> = {
  high: "dopasowanie wysokie",
  medium: "dopasowanie średnie",
  low: "dopasowanie niskie",
  excluded: "odpada",
};

const TIER_STYLE: Record<MatchView["tier"], string> = {
  high: "border-ok/40 bg-ok-soft text-ok",
  medium: "border-warn/40 bg-warn-soft text-warn",
  low: "border-border bg-muted text-muted-foreground",
  excluded: "border-bad/40 bg-bad-soft text-bad",
};

/** One "klocek": how well a driver fits the order being dragged, and why. */
export function MatchBlock({ match }: { match: MatchView }) {
  return (
    <div className={cn("rounded-md border px-2.5 py-1.5 text-xs", TIER_STYLE[match.tier])} data-testid={`match-${match.plates}`}>
      <div className="font-medium">{TIER_LABEL[match.tier]}</div>
      <div className="leading-snug">{match.reasons.join(" · ")}</div>
    </div>
  );
}
