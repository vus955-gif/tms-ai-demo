/**
 * Countries a client point can be in. Only countries reachable from Poland by
 * road without a ferry: routes to app-added points are estimated from a straight
 * line, which would cross the sea to Britain, Ireland or Scandinavia.
 */
export const COUNTRY_NAMES = {
  PL: "Polska",
  DE: "Niemcy",
  CZ: "Czechy",
  SK: "Słowacja",
  LT: "Litwa",
  LV: "Łotwa",
  EE: "Estonia",
  AT: "Austria",
  HU: "Węgry",
  SI: "Słowenia",
  HR: "Chorwacja",
  RO: "Rumunia",
  BG: "Bułgaria",
  NL: "Holandia",
  BE: "Belgia",
  LU: "Luksemburg",
  FR: "Francja",
  IT: "Włochy",
  ES: "Hiszpania",
  PT: "Portugalia",
  DK: "Dania",
  CH: "Szwajcaria",
  GR: "Grecja",
} as const;

export type Country = keyof typeof COUNTRY_NAMES;

export const COUNTRY_CODES = Object.keys(COUNTRY_NAMES) as [Country, ...Country[]];

/** Rough bounding boxes [west, south, east, north] — enough to catch a point in the wrong country, not a border survey. */
const BBOX: Record<Country, [number, number, number, number]> = {
  PL: [14.1, 49.0, 24.2, 54.9],
  DE: [5.85, 47.25, 15.05, 55.1],
  CZ: [12.05, 48.55, 18.9, 51.1],
  SK: [16.8, 47.7, 22.6, 49.65],
  LT: [20.9, 53.9, 26.9, 56.5],
  LV: [20.9, 55.6, 28.3, 58.1],
  EE: [21.7, 57.5, 28.3, 59.75],
  AT: [9.5, 46.35, 17.2, 49.05],
  HU: [16.1, 45.7, 22.95, 48.6],
  SI: [13.35, 45.4, 16.65, 46.9],
  HR: [13.4, 42.35, 19.5, 46.6],
  RO: [20.2, 43.6, 29.75, 48.3],
  BG: [22.3, 41.2, 28.65, 44.25],
  NL: [3.3, 50.7, 7.25, 53.6],
  BE: [2.5, 49.45, 6.45, 51.55],
  LU: [5.7, 49.4, 6.55, 50.2],
  FR: [-4.8, 42.3, 8.25, 51.15],
  IT: [6.6, 36.6, 18.55, 47.1],
  ES: [-9.35, 35.9, 3.35, 43.8],
  PT: [-9.55, 36.95, -6.15, 42.2],
  DK: [8.0, 54.55, 15.2, 57.8],
  CH: [5.95, 45.8, 10.5, 47.85],
  GR: [19.3, 34.8, 28.3, 41.75],
};

const MARGIN = 0.15;

export function inCountry(country: Country, lng: number, lat: number): boolean {
  const [w, s, e, n] = BBOX[country];
  return lng >= w - MARGIN && lng <= e + MARGIN && lat >= s - MARGIN && lat <= n + MARGIN;
}

/**
 * Countries whose box contains the point, the one it lies deepest inside first
 * (boxes overlap near borders: Cologne is inside both the German and the Dutch box,
 * but near the Dutch box's corner and well inside the German one).
 */
export function countriesAt(lng: number, lat: number): Country[] {
  const depth = (c: Country) => {
    const [w, s, e, n] = BBOX[c];
    return Math.min((lng - w) / (e - w), (e - lng) / (e - w), (lat - s) / (n - s), (n - lat) / (n - s));
  };
  return COUNTRY_CODES.filter((c) => inCountry(c, lng, lat)).sort((a, b) => depth(b) - depth(a));
}
