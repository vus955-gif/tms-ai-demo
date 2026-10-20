"use client";

import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { MAP_STYLE_URL, mapOverlayColors } from "@/components/monitoring/colors";
import { useMapStyle } from "@/components/theme/theme";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export type MapPin = { id: string; lng: number; lat: number; label: string; muted?: boolean };

type Props = {
  pins: MapPin[];
  /** When given, clicking the map places the pin being edited. */
  onPick?: (lng: number, lat: number) => void;
  /** Fly here when it changes (e.g. after an address search). */
  focus?: { lng: number; lat: number } | null;
  className?: string;
};

function markerElement(label: string, color: string, muted: boolean) {
  const el = document.createElement("div");
  el.className = "size-3.5 rounded-full border-2 shadow";
  el.style.background = color;
  el.style.borderColor = "#ffffff";
  el.style.opacity = muted ? "0.55" : "1";
  el.title = label;
  el.setAttribute("aria-label", label);
  return el;
}

/** A small map of a client's points; in pick mode a click sets the location of a new point. */
export function PointMap({ pins, onPick, focus, className }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const fitted = useRef(false);
  const onPickRef = useRef(onPick);
  const { theme } = useMapStyle();
  const appliedTheme = useRef(theme);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({ container: container.current, style: MAP_STYLE_URL[appliedTheme.current], center: [15, 51.5], zoom: 4.2, attributionControl: { compact: true } });
    map.current = instance;
    instance.addControl(new NavigationControl({ showCompass: false }), "top-left");
    instance.on("click", (e) => onPickRef.current?.(Math.round(e.lngLat.lng * 1e5) / 1e5, Math.round(e.lngLat.lat * 1e5) / 1e5));
    if (onPickRef.current) instance.getCanvas().style.cursor = "crosshair";
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // Markers are DOM elements on top of the map, so a style switch keeps them.
  useEffect(() => {
    const m = map.current;
    if (!m || appliedTheme.current === theme) return;
    appliedTheme.current = theme;
    m.setStyle(MAP_STYLE_URL[theme]);
  }, [theme]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of markers.current) mk.remove();
    const color = mapOverlayColors(theme).tracking;
    markers.current = pins.map((p) => new Marker({ element: markerElement(p.label, color, Boolean(p.muted)) }).setLngLat([p.lng, p.lat]).addTo(m));
    if (!fitted.current && pins.length > 0) {
      const bounds = new LngLatBounds();
      for (const p of pins) bounds.extend([p.lng, p.lat]);
      m.fitBounds(bounds, { padding: 40, maxZoom: 9, duration: 0 });
      fitted.current = true;
    }
  }, [pins, theme]);

  useEffect(() => {
    if (focus) map.current?.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.current.getZoom(), 12), duration: 600 });
  }, [focus]);

  return (
    <div
      ref={container}
      className={className ?? "h-56 w-full overflow-hidden rounded-lg border"}
      data-testid={onPick ? "point-picker" : "client-points-map"}
    />
  );
}
