/** Countries a point can be in (European road transport), with Polish names for the UI. */
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
  SE: "Szwecja",
  FI: "Finlandia",
  NO: "Norwegia",
  CH: "Szwajcaria",
  GB: "Wielka Brytania",
  IE: "Irlandia",
  GR: "Grecja",
} as const;

export type Country = keyof typeof COUNTRY_NAMES;

export const COUNTRY_CODES = Object.keys(COUNTRY_NAMES) as [Country, ...Country[]];
