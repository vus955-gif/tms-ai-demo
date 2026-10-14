"use client";

import { useLayoutEffect } from "react";
import { applyResolvedTheme, useResolvedTheme } from "./theme";

/**
 * Keeps <html> in step with the preference: after React's dev remount clears
 * the class set by the inline script, when the device switches between light
 * and dark, and when another tab changes the choice.
 */
export function ThemeSync() {
  const theme = useResolvedTheme();
  // Reads the stored choice itself, so the hydration pass (server snapshot) cannot undo the inline script.
  useLayoutEffect(() => applyResolvedTheme(), [theme]);
  return null;
}
