"use client";

import { LngLatBounds, Map as MapLibreMap, NavigationControl, type GeoJSONSource, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { VehicleView } from "@/server/monitoring/views";
import type { VehicleDetail } from "@/server/monitoring/vehicle-detail";

export const RISK_COLOR: Record<VehicleView["risk"], string> = {
  green: "#16a34a",
  yellow: "#d97706",
  red: "#dc2626",
  gray: "#94a3b8",
};

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron";
const FALLBACK_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_FALLBACK_URL || "";

type Props = {
  vehicles: VehicleView[];
  selectedId: string | null;
  detail: VehicleDetail | undefined;
  showAlternative: boolean;
  onSelect: (id: string) => void;
};

const emptyCollection = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

function vehicleFeatures(vehicles: VehicleView[], selectedId: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: vehicles.map((v) => ({
      type: "Feature",
      id: v.id,
      geometry: { type: "Point", coordinates: [v.lng, v.lat] },
      properties: { id: v.id, plates: v.plates, color: RISK_COLOR[v.risk], selected: v.id === selectedId ? 1 : 0, risk: v.risk },
    })),
  };
}

function routeFeatures(detail: VehicleDetail | undefined, showAlternative: boolean): GeoJSON.FeatureCollection {
  if (!detail) return emptyCollection();
  const features: GeoJSON.Feature[] = [];
  if (detail.route) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: detail.route.driven }, properties: { part: "driven" } });
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: detail.route.remaining }, properties: { part: "remaining" } });
  }
  if (showAlternative) {
    for (const alt of detail.alternatives) {
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: alt.coordinates }, properties: { part: "alternative" } });
    }
  }
  return { type: "FeatureCollection", features };
}

/** MapLibre map with vehicles coloured by risk and the selected vehicle's route. */
export function FleetMap({ vehicles, selectedId, detail, showAlternative, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!container.current) return;
    let triedFallback = false;
    const instance = new MapLibreMap({
      container: container.current,
      style: STYLE_URL,
      center: [17.5, 52],
      zoom: 5.4,
      attributionControl: { compact: true },
    });
    map.current = instance;
    instance.addControl(new NavigationControl({ showCompass: false }), "top-left");
    instance.on("error", (e) => {
      if (!triedFallback && FALLBACK_STYLE_URL && String(e.error?.message ?? "").toLowerCase().includes("style")) {
        triedFallback = true;
        instance.setStyle(FALLBACK_STYLE_URL);
      }
    });
    instance.on("load", () => {
      instance.addSource("route", { type: "geojson", data: emptyCollection() });
      instance.addLayer({
        id: "route-driven",
        type: "line",
        source: "route",
        filter: ["==", ["get", "part"], "driven"],
        paint: { "line-color": "#94a3b8", "line-width": 3, "line-opacity": 0.8 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      instance.addLayer({
        id: "route-remaining",
        type: "line",
        source: "route",
        filter: ["==", ["get", "part"], "remaining"],
        paint: { "line-color": "#1d6fa5", "line-width": 4 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      instance.addLayer({
        id: "route-alternative",
        type: "line",
        source: "route",
        filter: ["==", ["get", "part"], "alternative"],
        paint: { "line-color": "#7c3aed", "line-width": 4, "line-dasharray": [1.5, 1.2] },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      instance.addSource("vehicles", { type: "geojson", data: emptyCollection() });
      instance.addLayer({
        id: "vehicle-halo",
        type: "circle",
        source: "vehicles",
        filter: ["==", ["get", "selected"], 1],
        paint: { "circle-radius": 15, "circle-color": ["get", "color"], "circle-opacity": 0.22 },
      });
      instance.addLayer({
        id: "vehicle-dot",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], 1], 8, 6.5],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      instance.addLayer({
        id: "vehicle-label",
        type: "symbol",
        source: "vehicles",
        layout: {
          "text-field": ["get", "plates"],
          "text-size": 11,
          "text-offset": [0, 1.25],
          "text-anchor": "top",
          "text-font": ["Noto Sans Regular"],
          "text-allow-overlap": false,
        },
        paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
      });
      const select = (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") onSelectRef.current(id);
      };
      instance.on("click", "vehicle-dot", select);
      instance.on("mouseenter", "vehicle-dot", () => (instance.getCanvas().style.cursor = "pointer"));
      instance.on("mouseleave", "vehicle-dot", () => (instance.getCanvas().style.cursor = ""));
      setReady(true);
    });
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("vehicles") as GeoJSONSource | undefined)?.setData(vehicleFeatures(vehicles, selectedId));
    if (!fitted.current && vehicles.length > 0) {
      const bounds = new LngLatBounds();
      for (const v of vehicles) bounds.extend([v.lng, v.lat]);
      m.fitBounds(bounds, { padding: 60, duration: 0, maxZoom: 7 });
      fitted.current = true;
    }
  }, [ready, vehicles, selectedId]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("route") as GeoJSONSource | undefined)?.setData(routeFeatures(detail, showAlternative));
  }, [ready, detail, showAlternative]);

  const selectedVehicle = vehicles.find((v) => v.id === selectedId);
  const target = selectedVehicle ? `${selectedVehicle.id}` : null;
  const lastFlown = useRef<string | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !target || !selectedVehicle || lastFlown.current === target) return;
    lastFlown.current = target;
    m.flyTo({ center: [selectedVehicle.lng, selectedVehicle.lat], zoom: Math.max(m.getZoom(), 7.5), duration: 800 });
  }, [ready, target, selectedVehicle]);

  return <div ref={container} className="h-full w-full" data-testid="fleet-map" />;
}
