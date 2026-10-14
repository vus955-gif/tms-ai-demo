"use client";

import { useSyncExternalStore } from "react";
import { MAP_STYLE_KEY, THEME_KEY } from "./theme-script";

/** What the viewer picked: follow the device, or a fixed theme. */
export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
/** The map can follow the theme or stay light/dark on its own. */
export type MapStylePref = "auto" | "light" | "dark";

const EVENT = "tms-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(pref: ThemePref, systemIsDark: boolean): ResolvedTheme {
  return pref === "system" ? (systemIsDark ? "dark" : "light") : pref;
}

export function resolveMapTheme(pref: MapStylePref, theme: ResolvedTheme): ResolvedTheme {
  return pref === "auto" ? theme : pref;
}

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

const readThemePref = () => read<ThemePref>(THEME_KEY, ["system", "light", "dark"], "system");
const readMapStylePref = () => read<MapStylePref>(MAP_STYLE_KEY, ["auto", "light", "dark"], "auto");
const systemIsDark = () => {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
};
const readResolved = () => resolveTheme(readThemePref(), systemIsDark());

function subscribe(callback: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
    media.removeEventListener("change", callback);
  };
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice still applies until the page is reloaded.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Puts the theme on <html>, as the inline script does before the first paint. */
export function applyResolvedTheme() {
  const theme = readResolved();
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function useThemePref(): [ThemePref, (pref: ThemePref) => void] {
  const pref = useSyncExternalStore(subscribe, readThemePref, () => "system" as ThemePref);
  return [pref, (next) => write(THEME_KEY, next)];
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, readResolved, () => "light" as ResolvedTheme);
}

export function useMapStyle(): { pref: MapStylePref; theme: ResolvedTheme; setPref: (pref: MapStylePref) => void } {
  const pref = useSyncExternalStore(subscribe, readMapStylePref, () => "auto" as MapStylePref);
  const theme = useResolvedTheme();
  return { pref, theme: resolveMapTheme(pref, theme), setPref: (next) => write(MAP_STYLE_KEY, next) };
}
