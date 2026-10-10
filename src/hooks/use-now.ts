"use client";

import { useSyncExternalStore } from "react";

function subscribe(onTick: () => void) {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}

// Whole seconds keep the snapshot stable between ticks.
const getSnapshot = () => Math.floor(Date.now() / 1000) * 1000;
const getServerSnapshot = () => null;

/** Current time in ms, refreshed every second; null during server rendering. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
