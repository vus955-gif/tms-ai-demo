"use client";

import { Clock } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import { interpolatedSimNow, type ClientSnapshot } from "@/hooks/use-snapshot";
import { formatSimClock } from "@/lib/format";

/** Simulation clock that keeps ticking smoothly between server polls. */
export function SimClock({ snapshot }: { snapshot: ClientSnapshot | undefined }) {
  const now = useNow();
  const label = snapshot && now !== null ? formatSimClock(interpolatedSimNow(snapshot, now)) : "—";
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 font-mono text-sm tabular-nums"
      data-testid="sim-clock"
      aria-label="Czas symulacji"
    >
      <Clock className="size-3.5 text-muted-foreground" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
