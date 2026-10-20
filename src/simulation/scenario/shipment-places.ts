import type { ShipmentMode } from "@/domain/shipments";

/**
 * Ports, airports and rail terminals for sea/air/rail shipments, and indicative
 * lanes between them (waypoints keep a ship off the land on the map). The lane is
 * only drawn; where the cargo is comes from agent replies.
 */
export type ShipmentPlace = { id: string; name: string; nameEn?: string; country: string; lng: number; lat: number; modes: ShipmentMode[] };

export const shipmentPlaces: ShipmentPlace[] = [
  { id: "port-gdansk", name: "Gdańsk (DCT)", country: "PL", lng: 18.71, lat: 54.4, modes: ["sea"] },
  { id: "port-hamburg", name: "Hamburg", country: "DE", lng: 9.95, lat: 53.54, modes: ["sea"] },
  { id: "port-rotterdam", name: "Rotterdam", country: "NL", lng: 4.05, lat: 51.95, modes: ["sea"] },
  { id: "port-shanghai", name: "Szanghaj", nameEn: "Shanghai", country: "CN", lng: 122.07, lat: 30.62, modes: ["sea"] },
  { id: "port-ningbo", name: "Ningbo", country: "CN", lng: 121.85, lat: 29.93, modes: ["sea"] },
  { id: "port-singapore", name: "Singapur", nameEn: "Singapore", country: "SG", lng: 103.82, lat: 1.26, modes: ["sea"] },
  { id: "port-portsaid", name: "Port Said", country: "EG", lng: 32.3, lat: 31.26, modes: ["sea"] },
  { id: "port-newyork", name: "Nowy Jork / Newark", nameEn: "New York / Newark", country: "US", lng: -74.14, lat: 40.68, modes: ["sea"] },
  { id: "air-waw", name: "Warszawa (WAW)", nameEn: "Warsaw (WAW)", country: "PL", lng: 20.97, lat: 52.17, modes: ["air"] },
  { id: "air-fra", name: "Frankfurt (FRA)", country: "DE", lng: 8.57, lat: 50.03, modes: ["air"] },
  { id: "air-lej", name: "Lipsk (LEJ)", nameEn: "Leipzig (LEJ)", country: "DE", lng: 12.24, lat: 51.42, modes: ["air"] },
  { id: "air-ord", name: "Chicago (ORD)", country: "US", lng: -87.9, lat: 41.98, modes: ["air"] },
  { id: "air-jfk", name: "Nowy Jork (JFK)", nameEn: "New York (JFK)", country: "US", lng: -73.78, lat: 40.64, modes: ["air"] },
  { id: "air-pvg", name: "Szanghaj (PVG)", nameEn: "Shanghai (PVG)", country: "CN", lng: 121.8, lat: 31.14, modes: ["air"] },
  { id: "air-dxb", name: "Dubaj (DXB)", nameEn: "Dubai (DXB)", country: "AE", lng: 55.36, lat: 25.25, modes: ["air"] },
  { id: "rail-xian", name: "Xi'an (terminal)", country: "CN", lng: 109.1, lat: 34.4, modes: ["rail"] },
  { id: "rail-chengdu", name: "Chengdu (terminal)", country: "CN", lng: 104.07, lat: 30.67, modes: ["rail"] },
  { id: "rail-malaszewicze", name: "Małaszewicze", country: "PL", lng: 23.55, lat: 52.05, modes: ["rail"] },
  { id: "rail-lodz", name: "Łódź Olechów (terminal)", country: "PL", lng: 19.55, lat: 51.75, modes: ["rail"] },
  { id: "rail-duisburg", name: "Duisburg (terminal)", country: "DE", lng: 6.75, lat: 51.43, modes: ["rail"] },
];

export const placeById = (id: string) => shipmentPlaces.find((p) => p.id === id);

/** A place name (as stored on milestones) in the agent's language: "Szanghaj" → "Shanghai". */
export function localizePlace(name: string, language: "pl" | "en"): string {
  if (language === "pl") return name;
  return shipmentPlaces.find((p) => p.name === name)?.nameEn ?? name;
}

/** Waypoints between two places, by mode. Sea lanes go through straits; flights and trains are drawn as arcs between points. */
const SEA_ASIA_EUROPE: [number, number][] = [
  [122.07, 30.62], // Szanghaj
  [114, 12], // Morze Południowochińskie
  [104.2, 1.2], // Cieśnina Singapurska
  [95.5, 5.8], // północny cypel Sumatry
  [80.5, 5.6], // na południe od Sri Lanki
  [48, 12.5], // Zatoka Adeńska
  [43.4, 12.6], // Bab al-Mandab
  [38.5, 20], // Morze Czerwone
  [32.55, 29.95], // Kanał Sueski (południe)
  [32.3, 31.26], // Port Said
  [25, 34], // na południe od Krety
  [12, 37], // Kanał Sycylijski
  [-5.6, 35.95], // Gibraltar
  [-10, 39], // u wybrzeży Portugalii
  [-10.5, 43.5], // Finisterra
  [-6, 48.5], // Ouessant
  [1.5, 51.05], // Cieśnina Kaletańska
  [4.05, 51.95], // Rotterdam
  [6.5, 54], // Morze Północne
  [10.6, 57.9], // Skagen
  [12.7, 55.6], // Sund
  [14.5, 54.9], // na południe od Bornholmu
  [18.71, 54.4], // Gdańsk
];

const SEA_EUROPE_US: [number, number][] = [
  [18.71, 54.4],
  [14.5, 54.9],
  [12.7, 55.6],
  [10.6, 57.9],
  [3, 59],
  [-6, 59.5], // na północ od Szkocji
  [-30, 50],
  [-60, 42],
  [-74.14, 40.68],
];

const RAIL_CHINA_EUROPE: [number, number][] = [
  [109.1, 34.4], // Xi'an
  [103.8, 36.06], // Lanzhou
  [87.6, 43.8], // Urumczi
  [82.5, 45.25], // Dostyk / Alashankou
  [71.45, 51.15], // Astana
  [50.1, 53.2], // Samara
  [37.6, 55.7], // okolice Moskwy
  [27.55, 53.9], // Mińsk
  [23.7, 52.1], // Brześć
  [23.55, 52.05], // Małaszewicze
  [19.55, 51.75], // Łódź
];

const RAIL_TO_DUISBURG: [number, number][] = [
  [16.9, 52.4], // Poznań
  [13.4, 52.5], // Berlin
  [9.7, 52.35], // Hanower
  [6.75, 51.43], // Duisburg
];

const SEA_ROTTERDAM_US: [number, number][] = [
  [4.05, 51.95],
  [1.5, 51.05],
  [-6, 48.5],
  [-30, 45],
  [-60, 41.5],
  [-74.14, 40.68],
];

type Lane = { mode: ShipmentMode; from: string; to: string; path: () => [number, number][]; middle?: { name: string; fraction: number }; transitDays: number };

const from = (id: string, rest: [number, number][]): [number, number][] => {
  const p = placeById(id)!;
  return [[p.lng, p.lat], ...rest];
};

/**
 * Lanes a shipment can take. Sea and rail only where the demo knows a sensible line
 * on the map (a straight line would cross land); air between any two airports.
 * `transitDays` is a typical door-to-door planning default, editable on the form.
 */
const LANES: Lane[] = [
  { mode: "sea", from: "port-shanghai", to: "port-gdansk", path: () => SEA_ASIA_EUROPE, middle: { name: "Rotterdam", fraction: 0.85 }, transitDays: 38 },
  { mode: "sea", from: "port-ningbo", to: "port-gdansk", path: () => from("port-ningbo", SEA_ASIA_EUROPE.slice(1)), middle: { name: "Rotterdam", fraction: 0.85 }, transitDays: 38 },
  { mode: "sea", from: "port-singapore", to: "port-gdansk", path: () => from("port-singapore", SEA_ASIA_EUROPE.slice(3)), middle: { name: "Rotterdam", fraction: 0.8 }, transitDays: 30 },
  { mode: "sea", from: "port-gdansk", to: "port-shanghai", path: () => [...SEA_ASIA_EUROPE].reverse(), middle: { name: "Rotterdam", fraction: 0.12 }, transitDays: 40 },
  { mode: "sea", from: "port-gdansk", to: "port-newyork", path: () => SEA_EUROPE_US, transitDays: 16 },
  { mode: "sea", from: "port-rotterdam", to: "port-newyork", path: () => SEA_ROTTERDAM_US, transitDays: 10 },
  { mode: "sea", from: "port-hamburg", to: "port-newyork", path: () => from("port-hamburg", [[8.2, 54], [4, 52.3], ...SEA_ROTTERDAM_US.slice(1)]), transitDays: 11 },
  { mode: "rail", from: "rail-xian", to: "rail-lodz", path: () => RAIL_CHINA_EUROPE, middle: { name: "Małaszewicze", fraction: 0.85 }, transitDays: 18 },
  { mode: "rail", from: "rail-chengdu", to: "rail-lodz", path: () => from("rail-chengdu", RAIL_CHINA_EUROPE.slice(1)), middle: { name: "Małaszewicze", fraction: 0.85 }, transitDays: 19 },
  { mode: "rail", from: "rail-xian", to: "rail-duisburg", path: () => [...RAIL_CHINA_EUROPE.slice(0, -1), ...RAIL_TO_DUISBURG], middle: { name: "Małaszewicze", fraction: 0.78 }, transitDays: 21 },
  { mode: "rail", from: "rail-lodz", to: "rail-xian", path: () => [...RAIL_CHINA_EUROPE].reverse(), middle: { name: "Małaszewicze", fraction: 0.08 }, transitDays: 20 },
];

/** Typical air transit including handling at both ends. */
const AIR_TRANSIT_DAYS = 3;

function laneOf(mode: ShipmentMode, fromId: string, toId: string): Omit<Lane, "path"> & { path: [number, number][] } | null {
  const a = placeById(fromId);
  const b = placeById(toId);
  if (!a || !b || a.id === b.id || !a.modes.includes(mode) || !b.modes.includes(mode)) return null;
  if (mode === "air") return { mode, from: a.id, to: b.id, transitDays: AIR_TRANSIT_DAYS, path: [[a.lng, a.lat], [b.lng, b.lat]] };
  const lane = LANES.find((l) => l.mode === mode && l.from === fromId && l.to === toId);
  return lane ? { ...lane, path: lane.path() } : null;
}

/** Whether the demo can carry a shipment of this mode between the two places. */
export const laneExists = (mode: ShipmentMode, fromId: string, toId: string) => laneOf(mode, fromId, toId) !== null;

/** Waypoints of the lane (empty when there is no such lane); the server densifies them into arcs. */
export function lanePath(mode: ShipmentMode, fromId: string, toId: string): [number, number][] {
  return laneOf(mode, fromId, toId)?.path ?? [];
}

/** Sea transshipment or rail border crossing on the lane, if any. */
export function laneMiddle(mode: ShipmentMode, fromId: string, toId: string): { name: string; fraction: number } | null {
  return laneOf(mode, fromId, toId)?.middle ?? null;
}

/** Lanes for the form: every sea/rail lane, and air as "any two airports". */
export function laneOptions(): { mode: ShipmentMode; from: string; to: string; transitDays: number }[] {
  const air = shipmentPlaces.filter((p) => p.modes.includes("air"));
  return [
    ...LANES.map(({ mode, from: f, to, transitDays }) => ({ mode, from: f, to, transitDays })),
    ...air.flatMap((a) => air.filter((b) => b.id !== a.id).map((b) => ({ mode: "air" as const, from: a.id, to: b.id, transitDays: AIR_TRANSIT_DAYS }))),
  ];
}
