"use client";

import { LngLatBounds, Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { MapStyleToggle } from "@/components/theme/map-style-toggle";
import { useMapStyle, type ResolvedTheme } from "@/components/theme/theme";
import type { VehicleView } from "@/server/monitoring/views";
import type { VehicleDetail } from "@/server/monitoring/vehicle-detail";
import { MAP_STYLE_URL, mapOverlayColors, RISK_COLOR } from "./colors";

// The bundler does not emit MapLibre worker; scripts/copy-maplibre-worker.mjs puts it in public/.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

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

/** Our sources and layers on top of the base style; a style switch drops them, so they are added again. */
function addOverlay(instance: MapLibreMap, theme: ResolvedTheme) {
  const c = mapOverlayColors(theme);
  if (!instance.getSource("route")) instance.addSource("route", { type: "geojson", data: emptyCollection() });
  if (!instance.getSource("vehicles")) instance.addSource("vehicles", { type: "geojson", data: emptyCollection() });
  const layers: Parameters<MapLibreMap["addLayer"]>[0][] = [
    {
      id: "route-driven",
      type: "line",
      source: "route",
      filter: ["==", ["get", "part"], "driven"],
      paint: { "line-color": c.driven, "line-width": 3, "line-opacity": 0.8 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "route-remaining",
      type: "line",
      source: "route",
      filter: ["==", ["get", "part"], "remaining"],
      paint: { "line-color": c.remaining, "line-width": 4 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "route-alternative",
      type: "line",
      source: "route",
      filter: ["==", ["get", "part"], "alternative"],
      paint: { "line-color": c.alternative, "line-width": 4, "line-dasharray": [1.5, 1.2] },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      id: "vehicle-halo",
      type: "circle",
      source: "vehicles",
      filter: ["==", ["get", "selected"], 1],
      paint: { "circle-radius": 15, "circle-color": ["get", "color"], "circle-opacity": 0.22 },
    },
    {
      id: "vehicle-dot",
      type: "circle",
      source: "vehicles",
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], 1], 8, 6.5],
        "circle-color": ["get", "color"],
        "circle-stroke-color": c.dotStroke,
        "circle-stroke-width": 2,
      },
    },
    {
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
      paint: { "text-color": c.label, "text-halo-color": c.labelHalo, "text-halo-width": 1.4 },
    },
  ];
  for (const layer of layers) if (!instance.getLayer(layer.id)) instance.addLayer(layer);
}

/** MapLibre map with vehicles coloured by risk and the selected vehicle's route. */
export function FleetMap({ vehicles, selectedId, detail, showAlternative, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const { theme } = useMapStyle();
  const appliedTheme = useRef(theme);
  // Bumped whenever the overlay is (re)created, so the data effects push their data again.
  const [overlayRev, setOverlayRev] = useState(0);
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
      style: MAP_STYLE_URL[appliedTheme.current],
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
      addOverlay(instance, appliedTheme.current);
      // Layer listeners are kept by the map across style switches, so they are registered once.
      const select = (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") onSelectRef.current(id);
      };
      instance.on("click", "vehicle-dot", select);
      instance.on("mouseenter", "vehicle-dot", () => (instance.getCanvas().style.cursor = "pointer"));
      instance.on("mouseleave", "vehicle-dot", () => (instance.getCanvas().style.cursor = ""));
      setOverlayRev((r) => r + 1);
    });
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // Light/dark switch: new base style, then our layers again in matching colours.
  useEffect(() => {
    const m = map.current;
    if (!m || overlayRev === 0 || appliedTheme.current === theme) return;
    appliedTheme.current = theme;
    m.once("style.load", () => {
      // The latest choice, not this effect's: a quick second click replaces the style before it loads.
      addOverlay(m, appliedTheme.current);
      setOverlayRev((r) => r + 1);
    });
    m.setStyle(MAP_STYLE_URL[theme]);
  }, [theme, overlayRev]);

  useEffect(() => {
    const m = map.current;
    if (!overlayRev || !m) return;
    (m.getSource("vehicles") as GeoJSONSource | undefined)?.setData(vehicleFeatures(vehicles, selectedId));
    if (!fitted.current && vehicles.length > 0) {
      const bounds = new LngLatBounds();
      for (const v of vehicles) bounds.extend([v.lng, v.lat]);
      m.fitBounds(bounds, { padding: 60, duration: 0, maxZoom: 7 });
      fitted.current = true;
    }
  }, [overlayRev, vehicles, selectedId]);

  useEffect(() => {
    const m = map.current;
    if (!overlayRev || !m) return;
    (m.getSource("route") as GeoJSONSource | undefined)?.setData(routeFeatures(detail, showAlternative));
  }, [overlayRev, detail, showAlternative]);

  const selectedVehicle = vehicles.find((v) => v.id === selectedId);
  const target = selectedVehicle ? `${selectedVehicle.id}` : null;
  const lastFlown = useRef<string | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!overlayRev || !m || !target || !selectedVehicle || lastFlown.current === target) return;
    lastFlown.current = target;
    m.flyTo({ center: [selectedVehicle.lng, selectedVehicle.lat], zoom: Math.max(m.getZoom(), 7.5), duration: 800 });
  }, [overlayRev, target, selectedVehicle]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" data-testid="fleet-map" data-map-theme={theme} />
      <div className="pointer-events-none absolute right-3 top-3">
        <MapStyleToggle />
      </div>
    </div>
  );
}
