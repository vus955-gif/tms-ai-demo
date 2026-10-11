/**
 * Recurring orders of the demo clients (stage 4). Times are local (Warsaw),
 * minutes after midnight. All data is fictional.
 */
export type ScenarioTemplate = {
  id: string;
  name: string;
  clientId: string;
  pickupPointId: string;
  deliveryPointId: string;
  pickupFromMin: number;
  pickupToMin: number;
  deliveryDayOffset: number;
  deliveryFromMin: number;
  deliveryToMin: number;
  cargoPallets: number;
  cargoKg: number;
  bodyRequired: "plandeka" | "chlodnia" | "skrzynia" | null;
  references: string[];
  notes: string;
  weekdays: number[];
};

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

export const templatesSeed: ScenarioTemplate[] = [
  {
    id: "tpl-agropol-pasza",
    name: "Agro-Pol: pasza Kutno → Gdynia",
    clientId: "cl-agropol",
    pickupPointId: "pt-agropol-kutno",
    deliveryPointId: "pt-agropol-gdynia",
    pickupFromMin: h(6),
    pickupToMin: h(8),
    deliveryDayOffset: 0,
    deliveryFromMin: h(13),
    deliveryToMin: h(16),
    cargoPallets: 20,
    cargoKg: 9600,
    bodyRequired: null,
    references: ["AP-STAŁE"],
    notes: "Zlecenie stałe — pasza w workach",
    weekdays: [1, 3, 5],
  },
  {
    id: "tpl-baltic-chlodnia",
    name: "Baltic Foods: chłodnia Pruszcz → Janki",
    clientId: "cl-baltic",
    pickupPointId: "pt-baltic-pruszcz",
    deliveryPointId: "pt-baltic-janki",
    pickupFromMin: h(5),
    pickupToMin: h(6, 30),
    deliveryDayOffset: 0,
    deliveryFromMin: h(12),
    deliveryToMin: h(14),
    cargoPallets: 18,
    cargoKg: 7000,
    bodyRequired: "chlodnia",
    references: ["BF-RAMOWA"],
    notes: "Temperatura +2…+6 °C",
    weekdays: [1, 2, 3, 4, 5],
  },
  {
    id: "tpl-hanza-dostawy",
    name: "Hanza: dostawy Szczecin → Poznań",
    clientId: "cl-hanza",
    pickupPointId: "pt-hanza-szczecin",
    deliveryPointId: "pt-hanza-poznan",
    pickupFromMin: h(8),
    pickupToMin: h(10),
    deliveryDayOffset: 0,
    deliveryFromMin: h(15),
    deliveryToMin: h(18),
    cargoPallets: 26,
    cargoKg: 11000,
    bodyRequired: null,
    references: ["HR-STAŁE"],
    notes: "",
    weekdays: [2, 4],
  },
];
