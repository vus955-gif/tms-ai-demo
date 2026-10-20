import { HttpError } from "../http";

/**
 * Address search for the "Znajdź na mapie" button, through the public Nominatim
 * service (OpenStreetMap). Its usage policy (operations.osmfoundation.org/policies/nominatim,
 * checked 2026-10-20) asks for: at most 1 request per second for the whole app, an
 * identifying User-Agent, no search-as-you-type, caching, and OSM attribution.
 * So: one search per button press, a cache, a pause between calls and a per-world limit.
 * GEOCODER_URL can point to your own Nominatim; GEOCODER_URL=off turns the button off.
 */
export type GeoHit = { label: string; lat: number; lng: number };

const DEFAULT_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "tms-ai-demo/0.1 (+https://github.com/vus955-gif/tms-ai-demo)";
const MIN_GAP_MS = 1100;
const PER_WORLD = { max: 20, windowMs: 10 * 60_000 };

const cache = new Map<string, GeoHit[]>();
const perWorld = new Map<string, number[]>();
let lastCallMs = 0;

export function geocoderEnabled(): boolean {
  return process.env.GEOCODER_URL !== "off";
}

export async function geocode(
  sandboxId: string,
  query: string,
  country: string,
  deps: { fetch?: typeof fetch; gapMs?: number } = {},
): Promise<GeoHit[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const gapMs = deps.gapMs ?? MIN_GAP_MS;
  if (!geocoderEnabled()) throw new HttpError(503, "Wyszukiwanie adresów jest wyłączone — wskaż punkt na mapie.");
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 3) throw new HttpError(400, "Wpisz adres albo miejscowość (co najmniej 3 znaki).");
  const key = `${country.toLowerCase()}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const now = Date.now();
  const recent = (perWorld.get(sandboxId) ?? []).filter((t) => now - t < PER_WORLD.windowMs);
  if (recent.length >= PER_WORLD.max) throw new HttpError(429, "Za dużo wyszukiwań adresów — odczekaj chwilę albo wskaż punkt na mapie.");
  perWorld.set(sandboxId, [...recent, now]);
  if (perWorld.size > 1000) for (const [k, v] of perWorld) if (v.every((t) => now - t >= PER_WORLD.windowMs)) perWorld.delete(k);

  // Reserve the slot before waiting, so simultaneous searches queue one second apart instead of firing together.
  // (Per server instance; for a hard app-wide limit use your own Nominatim via GEOCODER_URL.)
  const slot = Math.max(now, lastCallMs + gapMs);
  lastCallMs = slot;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));

  const url = new URL(process.env.GEOCODER_URL || DEFAULT_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", "pl");
  url.searchParams.set("q", q);
  if (/^[A-Za-z]{2}$/.test(country)) url.searchParams.set("countrycodes", country.toLowerCase());
  let body: { display_name?: string; lat?: string; lon?: string }[];
  try {
    const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch {
    throw new HttpError(502, "Wyszukiwarka adresów nie odpowiada — wskaż punkt na mapie.");
  }
  const hits = (Array.isArray(body) ? body : [])
    .map((r) => ({ label: String(r.display_name ?? "").slice(0, 160), lat: Number(r.lat), lng: Number(r.lon) }))
    .filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng));
  if (cache.size > 500) cache.clear();
  cache.set(key, hits);
  return hits;
}
