import type { ScenarioClient, ScenarioContact } from "./types";

/** Fictional companies. `.example` domains are reserved and never resolve. */
export const clients: ScenarioClient[] = [
  { id: "cl-wisla", name: "Logistyka Wisła Sp. z o.o.", taxId: "000-000-00-01", emailDomain: "wisla-logistyka.example", isKey: true },
  { id: "cl-agropol", name: "Agro-Pol S.A.", taxId: "000-000-00-02", emailDomain: "agropol.example", isKey: false },
  { id: "cl-baltic", name: "Baltic Foods Sp. z o.o.", taxId: "000-000-00-03", emailDomain: "balticfoods.example", isKey: true },
  { id: "cl-mazovia", name: "Mazovia Electronics Sp. z o.o.", taxId: "000-000-00-04", emailDomain: "mazovia-electronics.example", isKey: false },
  { id: "cl-odra", name: "Odra Chem S.A.", taxId: "000-000-00-05", emailDomain: "odrachem.example", isKey: false },
  { id: "cl-meble", name: "Meble Wielkopolska Sp. z o.o.", taxId: "000-000-00-06", emailDomain: "meble-wlkp.example", isKey: true },
  { id: "cl-sudety", name: "Sudety Papier Sp. z o.o.", taxId: "000-000-00-07", emailDomain: "sudetypapier.example", isKey: false },
  { id: "cl-hanza", name: "Hanza Retail Sp. z o.o.", taxId: "000-000-00-08", emailDomain: "hanza-retail.example", isKey: false },
];

/** +48 999 is the emergency ambulance number, so these can never be real mobiles. */
export const contacts: ScenarioContact[] = [
  { id: "ct-wisla-1", clientId: "cl-wisla", name: "Marta Sobczak", email: "m.sobczak@wisla-logistyka.example", phone: "+48 999 200 101" },
  { id: "ct-wisla-2", clientId: "cl-wisla", name: "Tomasz Kubiak", email: "t.kubiak@wisla-logistyka.example", phone: "+48 999 200 102" },
  { id: "ct-agropol-1", clientId: "cl-agropol", name: "Halina Wróbel", email: "logistyka@agropol.example", phone: "+48 999 200 201" },
  { id: "ct-baltic-1", clientId: "cl-baltic", name: "Igor Malinowski", email: "i.malinowski@balticfoods.example", phone: "+48 999 200 301" },
  { id: "ct-baltic-2", clientId: "cl-baltic", name: "Natalia Jasińska", email: "dostawy@balticfoods.example", phone: "+48 999 200 302" },
  { id: "ct-mazovia-1", clientId: "cl-mazovia", name: "Robert Pawlak", email: "r.pawlak@mazovia-electronics.example", phone: "+48 999 200 401" },
  { id: "ct-odra-1", clientId: "cl-odra", name: "Beata Sikora", email: "b.sikora@odrachem.example", phone: "+48 999 200 501" },
  { id: "ct-meble-1", clientId: "cl-meble", name: "Grzegorz Baran", email: "g.baran@meble-wlkp.example", phone: "+48 999 200 601" },
  { id: "ct-meble-2", clientId: "cl-meble", name: "Joanna Duda", email: "reklamacje@meble-wlkp.example", phone: "+48 999 200 602" },
  { id: "ct-sudety-1", clientId: "cl-sudety", name: "Leszek Michalak", email: "l.michalak@sudetypapier.example", phone: "+48 999 200 701" },
  { id: "ct-hanza-1", clientId: "cl-hanza", name: "Olga Zawadzka", email: "o.zawadzka@hanza-retail.example", phone: "+48 999 200 801" },
];
