import type { ScenarioCoupling, ScenarioDriver, ScenarioTrailer, ScenarioVehicle } from "./types";

const tractor = (id: string, plates: string, homePointId: string, odometerKm: number, adr = false): ScenarioVehicle => ({
  id,
  kind: "tractor",
  plates,
  body: null,
  capacityPallets: 0,
  capacityKg: 0,
  adr,
  subjectTo561: true,
  international: true,
  odometerKm,
  homePointId,
});

const bus = (
  id: string,
  plates: string,
  homePointId: string,
  odometerKm: number,
  opts: { body: "plandeka" | "skrzynia"; pallets: number; international: boolean },
): ScenarioVehicle => ({
  id,
  kind: "bus",
  plates,
  body: opts.body,
  capacityPallets: opts.pallets,
  capacityKg: opts.pallets === 10 ? 1100 : 950,
  adr: false,
  // Vans under 3.5 t fall under Regulation 561/2006 only in international transport (since 1 July 2026).
  subjectTo561: opts.international,
  international: opts.international,
  odometerKm,
  homePointId,
});

export const vehicles: ScenarioVehicle[] = [
  tractor("v-po4k21", "PO 4K21", "pt-baza-poznan", 412_300),
  tractor("v-gd2m88", "GD 2M88", "pt-baza-poznan", 287_900),
  tractor("v-dw3h56", "DW 3H56", "pt-baza-wroclaw", 356_100, true),
  tractor("v-el5r30", "EL 5R30", "pt-baza-lodz", 501_700),
  tractor("v-po2c19", "PO 2C19", "pt-baza-poznan", 198_400),
  tractor("v-dw7m02", "DW 7M02", "pt-baza-wroclaw", 233_800),
  tractor("v-wb6p77", "WB 6P77", "pt-baza-lodz", 344_600),
  tractor("v-el9k41", "EL 9K41", "pt-baza-lodz", 121_500),
  tractor("v-po8z55", "PO 8Z55", "pt-baza-poznan", 389_200),
  bus("v-wx9t04", "WX 9T04", "pt-baza-lodz", 178_300, { body: "plandeka", pallets: 10, international: true }),
  bus("v-el3b12", "EL 3B12", "pt-baza-lodz", 245_900, { body: "skrzynia", pallets: 8, international: false }),
  bus("v-po6n88", "PO 6N88", "pt-baza-poznan", 96_400, { body: "plandeka", pallets: 10, international: false }),
  bus("v-dw1t07", "DW 1T07", "pt-baza-wroclaw", 154_700, { body: "skrzynia", pallets: 8, international: true }),
  bus("v-gd4w63", "GD 4W63", "pt-baza-poznan", 67_200, { body: "plandeka", pallets: 10, international: false }),
];

const curtain = (id: string, plates: string, parkedAtPointId: string | null = null): ScenarioTrailer => ({
  id,
  plates,
  body: "plandeka",
  capacityPallets: 33,
  capacityKg: 24_000,
  adr: false,
  parkedAtPointId,
});

export const trailers: ScenarioTrailer[] = [
  curtain("tr-po77n3", "PO 77N3"),
  { id: "tr-gd15pl", plates: "GD 15PL", body: "chlodnia", capacityPallets: 33, capacityKg: 22_000, adr: false, parkedAtPointId: null },
  { ...curtain("tr-dw80kr", "DW 80KR"), adr: true },
  curtain("tr-el21tm", "EL 21TM"),
  curtain("tr-po48dl", "PO 48DL"),
  curtain("tr-dw33fa", "DW 33FA"),
  curtain("tr-wb12gh", "WB 12GH"),
  curtain("tr-el66ss", "EL 66SS"),
  curtain("tr-po90lk", "PO 90LK"),
  curtain("tr-po11rs", "PO 11RS", "pt-baza-poznan"),
  curtain("tr-dw55bt", "DW 55BT", "pt-baza-wroclaw"),
];

export const couplings: ScenarioCoupling[] = [
  { vehicleId: "v-po4k21", trailerId: "tr-po77n3" },
  { vehicleId: "v-gd2m88", trailerId: "tr-gd15pl" },
  { vehicleId: "v-dw3h56", trailerId: "tr-dw80kr" },
  { vehicleId: "v-el5r30", trailerId: "tr-el21tm" },
  { vehicleId: "v-po2c19", trailerId: "tr-po48dl" },
  { vehicleId: "v-dw7m02", trailerId: "tr-dw33fa" },
  { vehicleId: "v-wb6p77", trailerId: "tr-wb12gh" },
  { vehicleId: "v-el9k41", trailerId: "tr-el66ss" },
  { vehicleId: "v-po8z55", trailerId: "tr-po90lk" },
];

const driver = (
  id: string,
  firstName: string,
  lastName: string,
  vehicleId: string,
  phoneSuffix: string,
  opts: { adr?: boolean; refusal?: number; extensions?: number } = {},
): ScenarioDriver => ({
  id,
  firstName,
  lastName,
  phone: `+48 999 100 ${phoneSuffix}`,
  email: null,
  adrCertificate: opts.adr ?? false,
  vehicleId,
  refusalPropensity: opts.refusal ?? 0.1,
  extensionsUsedThisWeek: opts.extensions ?? 0,
});

/** Van drivers refuse more often — a pattern dispatchers know from practice. */
const BUS_REFUSAL = 0.5;

export const drivers: ScenarioDriver[] = [
  driver("d-nowak", "Jan", "Nowak", "v-po4k21", "101", { extensions: 1 }),
  driver("d-wisniewska", "Anna", "Wiśniewska", "v-gd2m88", "102"),
  driver("d-zielinski", "Marek", "Zieliński", "v-dw3h56", "103", { adr: true }),
  driver("d-wojcik", "Tomasz", "Wójcik", "v-el5r30", "104", { extensions: 2 }),
  driver("d-kaminska", "Ewa", "Kamińska", "v-po2c19", "105"),
  driver("d-lewandowski", "Krzysztof", "Lewandowski", "v-dw7m02", "106", { extensions: 1 }),
  driver("d-szymanski", "Paweł", "Szymański", "v-wb6p77", "107"),
  driver("d-dabrowski", "Adam", "Dąbrowski", "v-el9k41", "108", { adr: true }),
  driver("d-wozniak", "Michał", "Woźniak", "v-po8z55", "109"),
  driver("d-kowalczyk", "Paweł", "Kowalczyk", "v-wx9t04", "110", { refusal: BUS_REFUSAL }),
  driver("d-mazur", "Rafał", "Mazur", "v-el3b12", "111", { refusal: BUS_REFUSAL }),
  driver("d-krawczyk", "Łukasz", "Krawczyk", "v-po6n88", "112", { refusal: BUS_REFUSAL }),
  driver("d-piotrowska", "Katarzyna", "Piotrowska", "v-dw1t07", "113", { refusal: BUS_REFUSAL }),
  driver("d-grabowski", "Jakub", "Grabowski", "v-gd4w63", "114", { refusal: BUS_REFUSAL }),
];
