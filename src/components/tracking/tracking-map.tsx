"use client";

import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { MAP_STYLE_URL, mapOverlayColors } from "@/components/monitoring/colors";
import { useResolvedTheme, type ResolvedTheme } from "@/components/theme/theme";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

type Props = { position: { lng: number; lat: number } | null; route: [number, number][] | null };

const emptyRoute = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

function addRoute(instance: MapLibreMap, theme: ResolvedTheme) {
  if (!instance.getSource("route")) instance.addSource("route", { type: "geojson", data: emptyRoute() });
  if (!instance.getLayer("route")) {
    instance.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": mapOverlayColors(theme).tracking, "line-width": 4, "line-opacity": 0.8 } });
  }
}

/** One truck and its remaining route — the client's view, nothing else on the map. Follows the client's device theme. */
export function TrackingMap({ position, route }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const theme = useResolvedTheme();
  const appliedTheme = useRef(theme);
  const [overlayRev, setOverlayRev] = useState(0);
  const fitted = useRef(false);

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({ container: container.current, style: MAP_STYLE_URL[appliedTheme.current], center: [17.5, 52], zoom: 5, attributionControl: { compact: true } });
    map.current = instance;
    instance.addControl(new NavigationControl({ showCompass: false }), "top-left");
    instance.on("load", () => {
      addRoute(instance, appliedTheme.current);
      setOverlayRev((r) => r + 1);
    });
    return () => instance.remove();
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || overlayRev === 0 || appliedTheme.current === theme) return;
    appliedTheme.current = theme;
    m.once("style.load", () => {
      addRoute(m, appliedTheme.current);
      setOverlayRev((r) => r + 1);
    });
    m.setStyle(MAP_STYLE_URL[theme]);
  }, [theme, overlayRev]);

  useEffect(() => {
    const m = map.current;
    if (!m || !overlayRev) return;
    (m.getSource("route") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: route && route.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: route }, properties: {} }] : [],
    });
    if (position) {
      if (!marker.current) {
        const el = document.createElement("div");
        el.className = "size-4 rounded-full border-2 shadow-md";
        el.setAttribute("aria-label", "Pozycja pojazdu");
        marker.current = new Marker({ element: el }).setLngLat([position.lng, position.lat]).addTo(m);
      } else {
        marker.current.setLngLat([position.lng, position.lat]);
      }
      const c = mapOverlayColors(appliedTheme.current);
      const el = marker.current.getElement();
      el.style.background = c.tracking;
      el.style.borderColor = c.dotStroke;
    }
    if (!fitted.current && (position || route)) {
      const bounds = new LngLatBounds();
      if (position) bounds.extend([position.lng, position.lat]);
      for (const c of route ?? []) bounds.extend(c);
      m.fitBounds(bounds, { padding: 48, maxZoom: 9, duration: 0 });
      fitted.current = true;
    }
  }, [position, route, overlayRev]);

  return <div ref={container} className="h-full min-h-72 w-full overflow-hidden rounded-xl border" data-testid="tracking-map" data-map-theme={theme} />;
}
