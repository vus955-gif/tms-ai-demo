"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { postJson } from "@/lib/api";
import type { ClockAction } from "@/server/clock-actions";
import type { Snapshot } from "@/server/snapshot";

export const SNAPSHOT_KEY = ["snapshot"] as const;
export const POLL_MS = 15_000;

export type ClientSnapshot = Snapshot & { fetchedAt: number };

async function fetchSnapshot(): Promise<ClientSnapshot> {
  const snapshot = await postJson<Snapshot>("/api/tick");
  return { ...snapshot, fetchedAt: Date.now() };
}

/** The world state, refreshed every 15 s (each refresh advances the world). */
export function useSnapshot() {
  return useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: fetchSnapshot,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: 2,
  });
}

function useSnapshotMutation<TVars>(request: (vars: TVars) => Promise<Snapshot>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (snapshot) => {
      queryClient.setQueryData<ClientSnapshot>(SNAPSHOT_KEY, { ...snapshot, fetchedAt: Date.now() });
      // Everything else derived from the world (lists, logs) is stale now.
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== SNAPSHOT_KEY[0] });
    },
  });
}

export function useClockAction() {
  return useSnapshotMutation((action: ClockAction) => postJson<Snapshot>("/api/sandbox/clock", action));
}

export function useResetWorld() {
  return useSnapshotMutation((vars: { randomRun: boolean }) => postJson<Snapshot>("/api/sandbox/reset", vars));
}

/** Simulation time "right now", interpolated between polls. */
export function interpolatedSimNow(snapshot: ClientSnapshot, realNowMs: number): number {
  const base = new Date(snapshot.simNow).getTime();
  return snapshot.running ? base + (realNowMs - snapshot.fetchedAt) * snapshot.speed : base;
}

/**
 * True once the first /api/tick has answered, i.e. the world cookie is set.
 * Other queries wait for it so parallel first requests do not create extra worlds.
 */
export function useWorldReady(): boolean {
  return Boolean(useSnapshot().data);
}
