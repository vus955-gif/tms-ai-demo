import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Foreign key to the owning demo world; every row disappears with its world. */
const sandboxRef = () =>
  text("sandbox_id")
    .notNull()
    .references(() => sandboxes.id, { onDelete: "cascade" });

export const sandboxes = pgTable("sandboxes", {
  id: text("id").primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
  seed: integer("seed").notNull(),
  randomRun: boolean("random_run").notNull().default(false),
  simOrigin: ts("sim_origin").notNull(),
  simElapsedMs: bigint("sim_elapsed_ms", { mode: "number" }).notNull().default(0),
  running: boolean("running").notNull().default(true),
  speed: integer("speed").notNull().default(10),
  realResumedAt: ts("real_resumed_at").notNull(),
  lastTickSim: ts("last_tick_sim").notNull(),
  version: integer("version").notNull().default(0),
  ipHash: text("ip_hash").notNull(),
  aiWindowStart: ts("ai_window_start"),
  aiCallsInWindow: integer("ai_calls_in_window").notNull().default(0),
});

export const points = pgTable(
  "points",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    clientId: text("client_id"),
    kind: text("kind").$type<"base" | "client">().notNull(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    country: text("country").$type<"PL" | "DE" | "CZ">().notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    openingHours: text("opening_hours").notNull(),
    requirements: text("requirements").notNull().default(""),
    notes: text("notes").notNull().default(""),
    handlingMinutes: integer("handling_minutes").notNull().default(45),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] })],
);

export const clients = pgTable(
  "clients",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    taxId: text("tax_id").notNull(),
    emailDomain: text("email_domain").notNull(),
    isKey: boolean("is_key").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] })],
);

export const clientContacts = pgTable(
  "client_contacts",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    clientId: text("client_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] })],
);

export const vehicles = pgTable(
  "vehicles",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    kind: text("kind").$type<"bus" | "solo" | "tractor">().notNull(),
    plates: text("plates").notNull(),
    body: text("body").$type<BodyType | null>(),
    capacityPallets: integer("capacity_pallets").notNull().default(0),
    capacityKg: integer("capacity_kg").notNull().default(0),
    adr: boolean("adr").notNull().default(false),
    subjectTo561: boolean("subject_to_561").notNull(),
    international: boolean("international").notNull().default(false),
    odometerKm: integer("odometer_km").notNull(),
    homePointId: text("home_point_id").notNull(),
    currentPointId: text("current_point_id"),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] })],
);

export type BodyType = "plandeka" | "chlodnia" | "skrzynia";

export const trailers = pgTable(
  "trailers",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    plates: text("plates").notNull(),
    body: text("body").$type<BodyType>().notNull(),
    capacityPallets: integer("capacity_pallets").notNull(),
    capacityKg: integer("capacity_kg").notNull(),
    adr: boolean("adr").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] })],
);

export const couplings = pgTable(
  "couplings",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    vehicleId: text("vehicle_id").notNull(),
    trailerId: text("trailer_id").notNull(),
    fromSim: ts("from_sim").notNull(),
    toSim: ts("to_sim"),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] })],
);

export const drivers = pgTable(
  "drivers",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    adrCertificate: boolean("adr_certificate").notNull().default(false),
    vehicleId: text("vehicle_id"),
    refusalPropensity: doublePrecision("refusal_propensity").notNull().default(0.1),
    extensionsUsedThisWeek: integer("extensions_used_this_week").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] })],
);

export type DriverActivityType = "driving" | "break" | "daily_rest" | "other_work";

export const driverActivities = pgTable(
  "driver_activities",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    driverId: text("driver_id").notNull(),
    type: text("type").$type<DriverActivityType>().notNull(),
    startSim: ts("start_sim").notNull(),
    endSim: ts("end_sim"),
    source: text("source").$type<"seed" | "plan">().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.id] }),
    index("driver_activities_driver_idx").on(t.sandboxId, t.driverId, t.startSim),
  ],
);

export const ORDER_STATUSES = [
  "SZKIC",
  "NOWE",
  "PRZYPISANE",
  "WYSLANE",
  "POTWIERDZONE",
  "ZALADUNEK",
  "W_DRODZE",
  "ROZLADUNEK",
  "DO_ZAMKNIECIA",
  "ZAMKNIETE",
  "ANULOWANE",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orders = pgTable(
  "orders",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    number: text("number").notNull(),
    clientId: text("client_id").notNull(),
    pickupPointId: text("pickup_point_id").notNull(),
    pickupFrom: ts("pickup_from").notNull(),
    pickupTo: ts("pickup_to").notNull(),
    deliveryPointId: text("delivery_point_id").notNull(),
    deliveryFrom: ts("delivery_from").notNull(),
    deliveryTo: ts("delivery_to").notNull(),
    cargoPallets: integer("cargo_pallets").notNull(),
    cargoKg: integer("cargo_kg").notNull(),
    bodyRequired: text("body_required").$type<BodyType | null>(),
    adrRequired: boolean("adr_required").notNull().default(false),
    references: jsonb("references").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    notes: text("notes").notNull().default(""),
    status: text("status").$type<OrderStatus>().notNull(),
    driverId: text("driver_id"),
    vehicleId: text("vehicle_id"),
    trailerId: text("trailer_id"),
    etd: ts("etd"),
    etaAgreed: ts("eta_agreed"),
    source: text("source").$type<"scenario" | "manual" | "email">().notNull(),
    sourceMessageId: text("source_message_id"),
    createdSim: ts("created_sim").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.id] }),
    index("orders_status_idx").on(t.sandboxId, t.status),
    index("orders_driver_idx").on(t.sandboxId, t.driverId),
  ],
);

export type StatusActor = "dispatcher" | "driver" | "ai" | "system";

export const orderStatusChanges = pgTable(
  "order_status_changes",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    orderId: text("order_id").notNull(),
    fromStatus: text("from_status").$type<OrderStatus | null>(),
    toStatus: text("to_status").$type<OrderStatus>().notNull(),
    actor: text("actor").$type<StatusActor>().notNull(),
    reason: text("reason").notNull().default(""),
    atSim: ts("at_sim").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.id] }),
    index("order_status_changes_order_idx").on(t.sandboxId, t.orderId),
  ],
);

export const driverClientHistory = pgTable(
  "driver_client_history",
  {
    sandboxId: sandboxRef(),
    driverId: text("driver_id").notNull(),
    clientId: text("client_id").notNull(),
    completedOrders: integer("completed_orders").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.driverId, t.clientId] })],
);

export const scheduledEvents = pgTable(
  "scheduled_events",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    dueSim: ts("due_sim").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    processedAtSim: ts("processed_at_sim"),
  },
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.id] }),
    index("scheduled_events_due_idx").on(t.sandboxId, t.processedAtSim, t.dueSim),
  ],
);

export const aiLog = pgTable(
  "ai_log",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    fn: text("fn").notNull(),
    model: text("model").notNull(),
    inputRef: text("input_ref").notNull().default(""),
    output: jsonb("output").$type<unknown>(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    reason: text("reason"),
    error: text("error"),
    atSim: ts("at_sim").notNull(),
    createdReal: ts("created_real").notNull().defaultNow(),
    actionTaken: text("action_taken"),
    reverted: boolean("reverted").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.id] }),
    index("ai_log_created_idx").on(t.sandboxId, t.createdReal),
  ],
);

/** Global (not per world) daily AI spend, used for the daily budget cap. */
export const aiBudgetDaily = pgTable("ai_budget_daily", {
  day: text("day").primaryKey(),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  calls: integer("calls").notNull().default(0),
});
