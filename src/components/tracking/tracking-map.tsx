"use client";

import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron";

type Props = { position: { lng: number; lat: number } | null; route: [number, number][] | null };

/** One truck and its remaining route — the client's view, nothing else on the map. */
export function TrackingMap({ position, route }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({ container: container.current, style: STYLE_URL, center: [17.5, 52], zoom: 5, attributionControl: { compact: true } });
    map.current = instance;
    instance.addControl(new NavigationControl({ showCompass: false }), "top-left");
    instance.on("load", () => {
      instance.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      instance.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#0f5c8c", "line-width": 4, "line-opacity": 0.8 } });
      setReady(true);
    });
    return () => instance.remove();
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("route") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: route && route.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: route }, properties: {} }] : [],
    });
    if (position) {
      if (!marker.current) {
        const el = document.createElement("div");
        el.className = "size-4 rounded-full border-2 border-white bg-[#0f5c8c] shadow-md";
        el.setAttribute("aria-label", "Pozycja pojazdu");
        marker.current = new Marker({ element: el }).setLngLat([position.lng, position.lat]).addTo(m);
      } else {
        marker.current.setLngLat([position.lng, position.lat]);
      }
    }
    if (!fitted.current && (position || route)) {
      const bounds = new LngLatBounds();
      if (position) bounds.extend([position.lng, position.lat]);
      for (const c of route ?? []) bounds.extend(c);
      m.fitBounds(bounds, { padding: 48, maxZoom: 9, duration: 0 });
      fitted.current = true;
    }
  }, [position, route, ready]);

  return <div ref={container} className="h-full min-h-72 w-full overflow-hidden rounded-xl border" data-testid="tracking-map" />;
}
