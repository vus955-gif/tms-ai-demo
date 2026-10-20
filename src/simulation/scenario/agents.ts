import type { QuoteMode, RoadRate } from "@/db/schema";

/**
 * Trusted freight agents of the demo (fictional companies, `.example` domains).
 * `replyRate` and `priceFactor` drive the reply bots only.
 */
export type ScenarioAgent = {
  id: string;
  company: string;
  contactName: string;
  email: string;
  modes: QuoteMode[];
  regions: string;
  replyRate: number;
  priceFactor: number;
  /** Bots answer in Polish or English, like real agents do. */
  language: "pl" | "en";
};

export const agentsSeed: ScenarioAgent[] = [
  { id: "ag-baltic-sea", company: "Baltic Ocean Lines Agency", contactName: "Karolina Nowicka", email: "rates@baltic-ocean.example", modes: ["sea"], regions: "Azja, Ameryka Płn.", replyRate: 0.85, priceFactor: 1.0, language: "pl" },
  { id: "ag-north-star", company: "North Star Shipping GmbH", contactName: "Jan Becker", email: "quotes@northstar-shipping.example", modes: ["sea"], regions: "Azja, Bliski Wschód", replyRate: 0.75, priceFactor: 0.94, language: "en" },
  { id: "ag-gdansk-cargo", company: "Gdańsk Cargo Partners", contactName: "Michał Lis", email: "oferty@gdansk-cargo.example", modes: ["sea", "rail"], regions: "Azja, Chiny (kolej)", replyRate: 0.7, priceFactor: 1.06, language: "pl" },
  { id: "ag-skyline", company: "Skyline Air Freight", contactName: "Emma Clarke", email: "air@skyline-freight.example", modes: ["air"], regions: "Ameryka Płn., Azja", replyRate: 0.8, priceFactor: 1.0, language: "en" },
  { id: "ag-aerocargo", company: "AeroCargo Polska", contactName: "Paweł Sikorski", email: "wyceny@aerocargo.example", modes: ["air"], regions: "cały świat", replyRate: 0.7, priceFactor: 1.08, language: "pl" },
  { id: "ag-silk-rail", company: "Silk Rail Logistics", contactName: "Li Wei", email: "booking@silkrail.example", modes: ["rail"], regions: "Chiny – Europa", replyRate: 0.8, priceFactor: 0.97, language: "en" },
  { id: "ag-eurasia", company: "Eurasia Rail Bridge", contactName: "Olga Petrenko", email: "sales@eurasia-bridge.example", modes: ["rail"], regions: "Chiny, Kazachstan", replyRate: 0.65, priceFactor: 1.04, language: "en" },
  { id: "ag-multi", company: "MultiModal Partners", contactName: "Tomasz Wrona", email: "rfq@multimodal.example", modes: ["sea", "air", "rail"], regions: "cały świat", replyRate: 0.6, priceFactor: 1.12, language: "pl" },
  // Module C: six agents per mode, each with its own lanes.
  { id: "ag-hanseatic", company: "Hanseatic Box Agency", contactName: "Lena Vogt", email: "ops@hanseatic-box.example", modes: ["sea"], regions: "Europa Płn., Ameryka Płn., Skandynawia", replyRate: 0.8, priceFactor: 1.02, language: "en" },
  { id: "ag-adriatic", company: "Adriatic & Med Shipping", contactName: "Marco Bellini", email: "booking@adriatic-med.example", modes: ["sea"], regions: "Morze Śródziemne, Afryka Płn., Bliski Wschód", replyRate: 0.7, priceFactor: 0.98, language: "en" },
  { id: "ag-waw-cargo", company: "Warsaw Air Cargo Services", contactName: "Agnieszka Kurek", email: "cargo@waw-aircargo.example", modes: ["air"], regions: "Europa, Ameryka Płn.", replyRate: 0.85, priceFactor: 1.03, language: "pl" },
  { id: "ag-fra-hub", company: "FRA Hub Logistics", contactName: "Stefan Krüger", email: "rates@fra-hub.example", modes: ["air"], regions: "cały świat", replyRate: 0.75, priceFactor: 0.99, language: "en" },
  { id: "ag-gulf-air", company: "Gulf Air Cargo Partners", contactName: "Omar Haddad", email: "sales@gulf-aircargo.example", modes: ["air"], regions: "Bliski Wschód, Azja, Afryka", replyRate: 0.7, priceFactor: 0.96, language: "en" },
  { id: "ag-polrail", company: "Polrail Intermodal", contactName: "Krzysztof Bielak", email: "intermodal@polrail.example", modes: ["rail"], regions: "Europa, Chiny (kolej)", replyRate: 0.8, priceFactor: 1.0, language: "pl" },
  { id: "ag-middle-corridor", company: "Middle Corridor Express", contactName: "Aigerim Sadykova", email: "desk@middle-corridor.example", modes: ["rail"], regions: "Kazachstan, Kaukaz, Turcja", replyRate: 0.6, priceFactor: 1.07, language: "en" },
];

/** Demo road rates (fictional). PLN for domestic transport, EUR abroad. */
export const roadRatesSeed: RoadRate[] = [
  { kind: "bus", label: "Bus do 3,5 t (8–10 palet)", perKmPln: 2.6, perKmEur: 0.65, minPln: 450, minEur: 120 },
  { kind: "solo", label: "Solówka 7,5–12 t (do 18 palet)", perKmPln: 3.9, perKmEur: 0.95, minPln: 700, minEur: 180 },
  { kind: "tractor", label: "Ciągnik z naczepą (33 palety)", perKmPln: 5.4, perKmEur: 1.35, minPln: 1000, minEur: 250 },
];
