"use client";

import { useSyncExternalStore } from "react";

/**
 * "Przewodnik": a short guided scenario for a first-time visitor. Per browser (localStorage), like the role
 * switch — it is a hint layer over the demo, not part of the demo world, so a world reset does not touch it.
 */
export const GUIDE_STEPS = ["pojazd", "sms", "cmr", "mail", "dziennik"] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number];
export type GuideTool = "phone" | "client-mail";

export type GuideState = { open: boolean; done: GuideStep[] };

const KEY = "tms-guide";
const EVENT = "tms-guide-change";
export const OPEN_TOOL_EVENT = "tms-open-tool";

/** What the server (and the very first client render) shows: nothing, so hydration always matches. */
const SERVER_STATE: GuideState = { open: false, done: [] };

let cached: { raw: string | null; state: GuideState } | null = null;

function parse(raw: string | null): GuideState {
  if (raw === null) {
    // First visit: open the guide where there is room for it; on a phone the header button invites instead.
    return { open: window.matchMedia("(min-width: 1024px)").matches, done: [] };
  }
  try {
    const value = JSON.parse(raw) as Partial<GuideState>;
    const done = Array.isArray(value.done) ? GUIDE_STEPS.filter((s) => (value.done as string[]).includes(s)) : [];
    return { open: value.open === true, done };
  } catch {
    return { open: false, done: [] };
  }
}

function read(): GuideState {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return SERVER_STATE;
  }
  // useSyncExternalStore needs the same object back while nothing has changed.
  if (!cached || cached.raw !== raw) cached = { raw, state: parse(raw) };
  return cached.state;
}

function write(next: GuideState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode: the guide still works until reload.
    cached = { raw: null, state: next };
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

export function useGuide(): GuideState {
  return useSyncExternalStore(subscribe, read, () => SERVER_STATE);
}

export function setGuideOpen(open: boolean) {
  write({ ...read(), open });
}

export function restartGuide() {
  write({ open: true, done: [] });
}

/** Called by the screens themselves when the visitor has actually done the thing a step describes. */
export function markGuideStep(step: GuideStep) {
  const state = read();
  if (state.done.includes(step)) return;
  write({ ...state, done: [...state.done, step] });
}

/** Asks a header tool (driver's phone, client mail) to open itself. */
export function openGuideTool(tool: GuideTool) {
  window.dispatchEvent(new CustomEvent<GuideTool>(OPEN_TOOL_EVENT, { detail: tool }));
}

export function onGuideToolRequest(tool: GuideTool, open: () => void) {
  const handler = (event: Event) => {
    if ((event as CustomEvent<GuideTool>).detail === tool) open();
  };
  window.addEventListener(OPEN_TOOL_EVENT, handler);
  return () => window.removeEventListener(OPEN_TOOL_EVENT, handler);
}
