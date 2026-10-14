"use client";

import { Map as MapIcon } from "lucide-react";
import { useMapStyle, type MapStylePref } from "./theme";

const NEXT: Record<MapStylePref, MapStylePref> = { auto: "light", light: "dark", dark: "auto" };
const LABEL: Record<MapStylePref, string> = { auto: "jak motyw", light: "jasna", dark: "ciemna" };

/** The map's own light/dark switch: follows the theme until the dispatcher picks one. */
export function MapStyleToggle() {
  const { pref, setPref } = useMapStyle();
  return (
    <button
      type="button"
      onClick={() => setPref(NEXT[pref])}
      className="pointer-events-auto flex items-center gap-1.5 rounded-md border bg-background/90 px-2 py-1 text-xs font-medium shadow-sm hover:bg-background"
      aria-label={`Styl mapy: ${LABEL[pref]} (kliknij, aby zmienić)`}
      title="Styl mapy: jak motyw → jasna → ciemna"
      data-testid="map-style-toggle"
    >
      <MapIcon className="size-3.5" aria-hidden />
      Mapa: {LABEL[pref]}
    </button>
  );
}
