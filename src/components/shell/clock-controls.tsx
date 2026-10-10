"use client";

import { Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useClockAction, type ClientSnapshot } from "@/hooks/use-snapshot";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 10, 60] as const;

export function ClockControls({ snapshot }: { snapshot: ClientSnapshot | undefined }) {
  const clock = useClockAction();
  const run = (action: Parameters<typeof clock.mutate>[0]) =>
    clock.mutate(action, { onError: (e) => toast.error(e.message) });

  return (
    <div className="flex items-center gap-1">
      <div className="flex rounded-md border p-0.5" role="group" aria-label="Tempo symulacji">
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => run({ action: "speed", speed })}
            disabled={!snapshot || clock.isPending}
            aria-pressed={snapshot?.speed === speed}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium tabular-nums transition-colors",
              snapshot?.speed === speed ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {speed}×
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!snapshot || clock.isPending}
        onClick={() => run({ action: snapshot?.running ? "pause" : "resume" })}
        aria-label={snapshot?.running ? "Zatrzymaj symulację" : "Wznów symulację"}
        data-testid="pause-toggle"
      >
        {snapshot?.running === false ? <Play /> : <Pause />}
      </Button>
    </div>
  );
}
