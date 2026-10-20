import { ROAD_CIRCUITY } from "./road-estimate";
import { normalize } from "./email-rules";

/**
 * Small built-in list of places for the Sales module: European cities for road
 * quote estimates and major world ports/airports for sea/air/rail inquiries.
 * Coordinates are city centres (rounded); distances from them are estimates.
 */
export type Place = { name: string; aliases: string[]; country: string; lat: number; lng: number; europe: boolean };

const P = (name: string, country: string, lat: number, lng: number, aliases: string[] = [], europe = true): Place => ({ name, aliases, country, lat, lng, europe });

export const PLACES: Place[] = [
  // Poland
  P("Warszawa", "PL", 52.23, 21.01, ["warsaw"]),
  P("Kraków", "PL", 50.06, 19.94, ["krakow", "cracow"]),
  P("Łódź", "PL", 51.76, 19.46, ["lodz"]),
  P("Wrocław", "PL", 51.11, 17.03, ["wroclaw"]),
  P("Poznań", "PL", 52.41, 16.93, ["poznan"]),
  P("Gdańsk", "PL", 54.35, 18.65, ["gdansk"]),
  P("Gdynia", "PL", 54.52, 18.53),
  P("Szczecin", "PL", 53.43, 14.55),
  P("Katowice", "PL", 50.26, 19.02),
  P("Lublin", "PL", 51.25, 22.57),
  P("Białystok", "PL", 53.13, 23.16, ["bialystok"]),
  P("Bydgoszcz", "PL", 53.12, 18.01),
  P("Toruń", "PL", 53.01, 18.6, ["torun"]),
  P("Rzeszów", "PL", 50.04, 22.0, ["rzeszow"]),
  P("Kielce", "PL", 50.87, 20.63),
  P("Opole", "PL", 50.67, 17.93),
  P("Olsztyn", "PL", 53.78, 20.49),
  P("Zielona Góra", "PL", 51.94, 15.51, ["zielona gora"]),
  P("Kalisz", "PL", 51.76, 18.09),
  P("Kutno", "PL", 52.23, 19.36),
  // Germany
  P("Berlin", "DE", 52.52, 13.4, ["berlina"]),
  P("Hamburg", "DE", 53.55, 9.99),
  P("München", "DE", 48.14, 11.58, ["monachium", "munich", "munchen"]),
  P("Köln", "DE", 50.94, 6.96, ["kolonia", "cologne", "koln"]),
  P("Frankfurt", "DE", 50.11, 8.68, ["frankfurt nad menem"]),
  P("Stuttgart", "DE", 48.78, 9.18),
  P("Düsseldorf", "DE", 51.23, 6.78, ["dusseldorf"]),
  P("Leipzig", "DE", 51.34, 12.37, ["lipsk"]),
  P("Dresden", "DE", 51.05, 13.74, ["drezno"]),
  P("Hannover", "DE", 52.37, 9.73, ["hanower"]),
  P("Nürnberg", "DE", 49.45, 11.08, ["norymberga", "nuremberg", "nurnberg"]),
  P("Bremen", "DE", 53.08, 8.8, ["brema"]),
  P("Dortmund", "DE", 51.51, 7.47),
  P("Duisburg", "DE", 51.43, 6.76),
  // Central Europe
  P("Praha", "CZ", 50.08, 14.44, ["praga", "prague"]),
  P("Brno", "CZ", 49.2, 16.61),
  P("Ostrava", "CZ", 49.82, 18.26, ["ostrawa"]),
  P("Bratislava", "SK", 48.15, 17.11, ["bratysława", "bratyslawa"]),
  P("Budapest", "HU", 47.5, 19.04, ["budapeszt"]),
  P("Wien", "AT", 48.21, 16.37, ["wiedeń", "wieden", "vienna"]),
  P("Linz", "AT", 48.31, 14.29),
  P("Graz", "AT", 47.07, 15.44),
  P("Ljubljana", "SI", 46.06, 14.51, ["lublana"]),
  P("Zürich", "CH", 47.38, 8.54, ["zurych", "zurich"]),
  // Benelux, France
  P("Amsterdam", "NL", 52.37, 4.9),
  P("Rotterdam", "NL", 51.92, 4.48),
  P("Venlo", "NL", 51.37, 6.17),
  P("Antwerpen", "BE", 51.22, 4.4, ["antwerpia", "antwerp"]),
  P("Bruxelles", "BE", 50.85, 4.35, ["bruksela", "brussels"]),
  P("Liège", "BE", 50.63, 5.57, ["liege"]),
  P("Paris", "FR", 48.86, 2.35, ["paryż", "paryz"]),
  P("Lyon", "FR", 45.76, 4.84),
  P("Lille", "FR", 50.63, 3.06),
  P("Strasbourg", "FR", 48.57, 7.75, ["strasburg"]),
  P("Marseille", "FR", 43.3, 5.37, ["marsylia"]),
  // South
  P("Milano", "IT", 45.46, 9.19, ["mediolan", "milan"]),
  P("Verona", "IT", 45.44, 10.99, ["werona"]),
  P("Bologna", "IT", 44.49, 11.34, ["bolonia"]),
  P("Torino", "IT", 45.07, 7.69, ["turyn", "turin"]),
  P("Barcelona", "ES", 41.39, 2.17, ["barcelona"]),
  P("Madrid", "ES", 40.42, -3.7, ["madryt"]),
  P("Valencia", "ES", 39.47, -0.38, ["walencja"]),
  // North, Baltics, East
  P("København", "DK", 55.68, 12.57, ["kopenhaga", "copenhagen", "kobenhavn"]),
  P("Malmö", "SE", 55.6, 13.0, ["malmo"]),
  P("Göteborg", "SE", 57.71, 11.97, ["goteborg", "gothenburg"]),
  P("Stockholm", "SE", 59.33, 18.07, ["sztokholm"]),
  P("Vilnius", "LT", 54.69, 25.28, ["wilno"]),
  P("Kaunas", "LT", 54.9, 23.9, ["kowno"]),
  P("Riga", "LV", 56.95, 24.11, ["ryga"]),
  P("Tallinn", "EE", 59.44, 24.75),
  P("București", "RO", 44.43, 26.1, ["bukareszt", "bucharest", "bucuresti"]),
  P("Lwów", "UA", 49.84, 24.03, ["lviv", "lwow"]),
  P("London", "GB", 51.51, -0.13, ["londyn"]),
  // World ports and airports (sea / air / rail inquiries)
  P("Shanghai", "CN", 31.23, 121.47, ["szanghaj"], false),
  P("Ningbo", "CN", 29.87, 121.54, [], false),
  P("Shenzhen", "CN", 22.54, 114.06, ["shenzen"], false),
  P("Qingdao", "CN", 36.07, 120.38, ["tsingtao"], false),
  P("Chengdu", "CN", 30.57, 104.07, ["czengdu"], false),
  P("Xi'an", "CN", 34.34, 108.94, ["xian", "sian"], false),
  P("Chongqing", "CN", 29.56, 106.55, ["czungking"], false),
  P("Hongkong", "HK", 22.32, 114.17, ["hong kong"], false),
  P("Busan", "KR", 35.18, 129.08, ["pusan"], false),
  P("Singapur", "SG", 1.29, 103.85, ["singapore"], false),
  P("Tokio", "JP", 35.68, 139.69, ["tokyo"], false),
  P("Mumbai", "IN", 19.08, 72.88, ["bombaj"], false),
  P("Dubaj", "AE", 25.2, 55.27, ["dubai"], false),
  P("Nowy Jork", "US", 40.71, -74.01, ["new york", "nyc"], false),
  P("Chicago", "US", 41.88, -87.63, [], false),
  P("Los Angeles", "US", 34.05, -118.24, [], false),
  P("Toronto", "CA", 43.65, -79.38, [], false),
  P("Montreal", "CA", 45.5, -73.57, ["montreal"], false),
];

/** Consonant skeleton survives Polish declension (Szanghaj/Szanghaju, Gdańsk/Gdańska, Poznań/Poznania). */
const skeleton = (word: string) => normalize(word).replace(/[^a-z]/g, "").replace(/[aeiouy]/g, "");

const names = (p: Place) => [p.name, ...p.aliases].map(normalize);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\']/g, "\\$&");

/** Places mentioned in a text, in order of appearance. `extra`: e.g. the client's own points. */
export function placesIn(text: string, extra: Place[] = []): Place[] {
  const norm = normalize(text);
  const words = norm.split(/[^a-z0-9']+/).filter(Boolean);
  const found: { place: Place; at: number }[] = [];
  for (const place of [...PLACES, ...extra]) {
    let at = -1;
    const take = (i: number) => {
      if (i >= 0 && (at < 0 || i < at)) at = i;
    };
    for (const n of names(place)) {
      take(norm.search(new RegExp(`(^|[^a-z])${escapeRe(n)}([^a-z]|$)`)));
      // Declined single-word names: same consonant skeleton, at least 4 consonants.
      const sk = n.includes(" ") ? "" : skeleton(n);
      if (sk.length >= 4) {
        const word = words.find((w) => skeleton(w) === sk);
        if (word) take(norm.search(new RegExp(`(^|[^a-z])${escapeRe(word)}`)));
      }
    }
    if (at >= 0) found.push({ place, at });
  }
  const ordered = found.sort((a, b) => a.at - b.at).map((f) => f.place);
  return ordered.filter((p, i) => ordered.findIndex((q) => normalize(q.name) === normalize(p.name)) === i);
}

export function findPlace(name: string | null | undefined): Place | null {
  if (!name) return null;
  return placesIn(name)[0] ?? null;
}

const R = 6371;
export function greatCircleKm(a: Place, b: Place): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Typical road circuity in Europe; the estimate is labelled as such in the UI. */
/** Road km ≈ straight line × this (median of the precomputed OSRM routes, see road-estimate.ts). */
export const ROAD_DETOUR_FACTOR = ROAD_CIRCUITY;
