// Copies the MapLibre web worker next to the static assets; the bundler does not emit it.
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const from = path.join(process.cwd(), "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const toDir = path.join(process.cwd(), "public", "maplibre");
mkdirSync(toDir, { recursive: true });
copyFileSync(from, path.join(toDir, "maplibre-gl-worker.mjs"));
console.log("MapLibre worker copied to public/maplibre/");
