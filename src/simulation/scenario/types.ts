import type { BodyType, DriverActivityType, OrderStatus } from "@/db/schema";

export type Country = "PL" | "DE" | "CZ";

export type ScenarioPoint = {
  id: string;
  clientId: string | null;
  kind: "base" | "client";
  name: string;
  address: string;
  city: string;
  country: Country;
  lat: number;
  lng: number;
  openingHours: string;
  requirements: string;
  notes: string;
  handlingMinutes: number;
};

export type ScenarioClient = {
  id: string;
  name: string;
  taxId: string;
  emailDomain: string;
  isKey: boolean;
};

export type ScenarioContact = {
  id: string;
  clientId: string;
  name: string;
  email: string;
  phone: string;
};

export type ScenarioVehicle = {
  id: string;
  kind: "bus" | "solo" | "tractor";
  plates: string;
  body: BodyType | null;
  capacityPallets: number;
  capacityKg: number;
  adr: boolean;
  subjectTo561: boolean;
  international: boolean;
  odometerKm: number;
  homePointId: string;
};

export type ScenarioTrailer = {
  id: string;
  plates: string;
  body: BodyType;
  capacityPallets: number;
  capacityKg: number;
  adr: boolean;
  /** Where an uncoupled trailer is parked. */
  parkedAtPointId: string | null;
};

export type ScenarioCoupling = { vehicleId: string; trailerId: string };

export type ScenarioDriver = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  adrCertificate: boolean;
  vehicleId: string;
  refusalPropensity: number;
  extensionsUsedThisWeek: number;
};

/** Activity relative to simulation start, in minutes (negative = before start; null end = ongoing). */
export type ScenarioActivity = {
  driverId: string;
  type: DriverActivityType;
  startMin: number;
  endMin: number | null;
};

/** Where an active vehicle is at simulation start. */
export type ScenarioProgress =
  | { stage: "to_pickup"; fromPointId: string; progress: number }
  | { stage: "to_delivery"; progress: number };

export type ScenarioOrder = {
  id: string;
  number: string;
  clientId: string;
  pickupPointId: string;
  /** Window bounds relative to simulation start, in minutes. */
  pickupFromMin: number;
  pickupToMin: number;
  deliveryPointId: string;
  deliveryFromMin: number;
  deliveryToMin: number;
  cargoPallets: number;
  cargoKg: number;
  bodyRequired: BodyType | null;
  adrRequired: boolean;
  references: string[];
  notes: string;
  status: Extract<OrderStatus, "POTWIERDZONE" | "ZALADUNEK" | "W_DRODZE">;
  driverId: string;
  vehicleId: string;
  start: ScenarioProgress;
};

export type ScenarioHistory = { driverId: string; clientId: string; completedOrders: number };

export type ScenarioIdleVehicle = { vehicleId: string; pointId: string };

export type Scenario = {
  points: ScenarioPoint[];
  clients: ScenarioClient[];
  contacts: ScenarioContact[];
  vehicles: ScenarioVehicle[];
  trailers: ScenarioTrailer[];
  couplings: ScenarioCoupling[];
  drivers: ScenarioDriver[];
  activities: ScenarioActivity[];
  orders: ScenarioOrder[];
  idleVehicles: ScenarioIdleVehicle[];
  history: ScenarioHistory[];
};
