"use client";

import { useSyncExternalStore } from "react";

/** "Spedytor / Handlowiec" switch (Sales spec): only changes the menu, per viewer. */
export type Role = "spedytor" | "handlowiec";

const KEY = "tms-role";
const EVENT = "tms-role-change";

function read(): Role {
  try {
    return localStorage.getItem(KEY) === "handlowiec" ? "handlowiec" : "spedytor";
  } catch {
    return "spedytor";
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

export function useRole(): [Role, (role: Role) => void] {
  const role = useSyncExternalStore(subscribe, read, () => "spedytor" as Role);
  const set = (next: Role) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the switch still works until reload.
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [role, set];
}
