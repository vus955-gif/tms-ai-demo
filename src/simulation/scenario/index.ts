import { clients, contacts } from "./clients";
import { couplings, drivers, trailers, vehicles } from "./fleet";
import { activities, history, idleVehicles, orders } from "./operations";
import { points } from "./points";
import type { Scenario } from "./types";

export const scenario: Scenario = {
  points,
  clients,
  contacts,
  vehicles,
  trailers,
  couplings,
  drivers,
  activities,
  orders,
  idleVehicles,
  history,
};

export type * from "./types";
