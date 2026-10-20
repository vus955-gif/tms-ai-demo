"use client";

import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { MAP_STYLE_URL, mapOverlayColors } from "@/components/monitoring/colors";
import { useMapStyle, type ResolvedTheme } from "@/components/theme/theme";
import type { ShipmentDetail } from "@/server/shipments/views";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

type MapData = ShipmentDetail["map"];

/** Longitudes that keep increasing across the 180° meridian, so a Pacific crossing is not drawn around the world. */
export function unwrapPath(path: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [lng, lat] of path) {
    const prev = out.at(-1);
    let x = lng;
    if (prev) while (x - prev[0] > 180) x -= 360;
    if (prev) while (prev[0] - x > 180) x += 360;
    out.push([x, lat]);
  }
  return out;
}

/** The copy of a point (±360°) that lies next to the drawn lane. */
function nearLane(lng: number, lane: [number, number][]): number {
  if (lane.length === 0) return lng;
  const options = [lng - 360, lng, lng + 360];
  const dist = (x: number) => Math.min(...lane.map((p) => Math.abs(p[0] - x)));
  return options.reduce((best, x) => (dist(x) < dist(best) ? x : best), lng);
}

function addLane(instance: MapLibreMap, theme: ResolvedTheme) {
  if (!instance.getSource("lane")) instance.addSource("lane", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  if (!instance.getLayer("lane")) {
    instance.addLayer({ id: "lane", type: "line", source: "lane", paint: { "line-color": mapOverlayColors(theme).remaining, "line-width": 3, "line-opacity": 0.75, "line-dasharray": [2, 1.5] } });
  }
}

function dot(label: string, kind: "place" | "last", theme: ResolvedTheme) {
  const c = mapOverlayColors(theme);
  const el = document.createElement("div");
  el.className = kind === "last" ? "size-4 rounded-full border-2 shadow-md" : "size-3 rounded-full border-2 shadow";
  el.style.background = kind === "last" ? c.tracking : c.driven;
  el.style.borderColor = c.dotStroke;
  el.title = label;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  return el;
}

/**
 * The lane of a shipment (indicative, dashed), its ports or terminals and the last
 * place an agent or the forwarder confirmed. No live position: that would need a
 * paid provider (see docs/sledzenie-przesylek.md).
 */
export function ShipmentMap({ data }: { data: MapData }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const { theme } = useMapStyle();
  const appliedTheme = useRef(theme);
  const [overlayRev, setOverlayRev] = useState(0);
  const lane = useMemo(() => unwrapPath(data.path), [data.path]);

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({ container: container.current, style: MAP_STYLE_URL[appliedTheme.current], center: [40, 40], zoom: 1.5, attributionControl: { compact: true } });
    map.current = instance;
    instance.addControl(new NavigationControl({ showCompass: false }), "top-left");
    instance.on("load", () => {
      addLane(instance, appliedTheme.current);
      setOverlayRev((r) => r + 1);
    });
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || overlayRev === 0 || appliedTheme.current === theme) return;
    appliedTheme.current = theme;
    m.once("style.load", () => {
      addLane(m, appliedTheme.current);
      setOverlayRev((r) => r + 1);
    });
    m.setStyle(MAP_STYLE_URL[theme]);
  }, [theme, overlayRev]);

  // Lane and markers; the view is fitted once per lane.
  const fittedFor = useRef("");
  useEffect(() => {
    const m = map.current;
    if (!m || !overlayRev) return;
    (m.getSource("lane") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: lane.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: lane }, properties: {} }] : [],
    });
    for (const mk of markers.current) mk.remove();
    const places = [data.origin, data.middle, data.destination].filter((p): p is NonNullable<typeof p> => p !== null);
    markers.current = places.map((p) => new Marker({ element: dot(p.name, "place", appliedTheme.current) }).setLngLat([nearLane(p.lng, lane), p.lat]).addTo(m));
    if (data.lastConfirmed) {
      const l = data.lastConfirmed;
      markers.current.push(new Marker({ element: dot(`Ostatnio potwierdzone: ${l.label} — ${l.name}`, "last", appliedTheme.current) }).setLngLat([nearLane(l.lng, lane), l.lat]).addTo(m));
    }
    const signature = `${lane.length}:${lane[0]?.join(",")}:${lane.at(-1)?.join(",")}`;
    if (lane.length > 0 && fittedFor.current !== signature) {
      const bounds = new LngLatBounds();
      for (const c of lane) bounds.extend(c);
      m.fitBounds(bounds, { padding: 36, maxZoom: 6, duration: 0 });
      fittedFor.current = signature;
    }
  }, [lane, data.origin, data.middle, data.destination, data.lastConfirmed, overlayRev]);

  return <div ref={container} className="h-64 w-full overflow-hidden rounded-lg border" data-testid="shipment-map" />;
}
