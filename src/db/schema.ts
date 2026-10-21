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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Country } from "@/domain/countries";

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
  /** Driver the visitor currently plays in the "Telefon kierowcy" demo tool (that bot stays silent). */
  phoneDriverId: text("phone_driver_id"),
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
    country: text("country").$type<Country>().notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    openingHours: text("opening_hours").notNull(),
    requirements: text("requirements").notNull().default(""),
    notes: text("notes").notNull().default(""),
    handlingMinutes: integer("handling_minutes").notNull().default(45),
    /** "manual": added in the app — no precomputed road routes, the system uses approximate ones. */
    source: text("source").$type<"scenario" | "manual">().notNull().default("scenario"),
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
    /** Where an uncoupled trailer stands (base or client point); null while coupled. */
    parkedAtPointId: text("parked_at_point_id"),
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
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.id] }),
    // One trailer per tractor and one tractor per trailer at a time, whatever two clicks do at once.
    uniqueIndex("couplings_open_vehicle_uq").on(t.sandboxId, t.vehicleId).where(sql`${t.toSim} is null`),
    uniqueIndex("couplings_open_trailer_uq").on(t.sandboxId, t.trailerId).where(sql`${t.toSim} is null`),
  ],
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
    source: text("source").$type<"scenario" | "manual" | "email" | "template">().notNull(),
    /** Recurring orders (stage 4): `<templateId>:<yyyy-mm-dd>`, one live (not cancelled) order per template and day. */
    templateKey: text("template_key"),
    /** Assigned, order SMS not sent yet: when it goes out (the day before the run). */
    smsDueSim: ts("sms_due_sim"),
    sourceMessageId: text("source_message_id"),
    createdSim: ts("created_sim").notNull(),
    arrivedPickupAt: ts("arrived_pickup_at"),
    departedPickupAt: ts("departed_pickup_at"),
    arrivedDeliveryAt: ts("arrived_delivery_at"),
    unloadedAt: ts("unloaded_at"),
    /** Latest predicted arrival at the delivery point (for lists and client views). */
    etaPredicted: ts("eta_predicted"),
    risk: text("risk").$type<"green" | "yellow" | "red" | null>(),
  },
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.id] }),
    index("orders_status_idx").on(t.sandboxId, t.status),
    index("orders_driver_idx").on(t.sandboxId, t.driverId),
    uniqueIndex("orders_template_key_uq").on(t.sandboxId, t.templateKey).where(sql`${t.status} <> 'ANULOWANE'`),
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

export type VehicleMode = "driving" | "break" | "daily_rest" | "handling" | "waiting" | "stopped" | "idle";
export type LegPurpose = "to_pickup" | "to_delivery";

/** Live state of each vehicle at `lastTickSim` (re-anchored every tick). */
export const vehicleStates = pgTable(
  "vehicle_states",
  {
    sandboxId: sandboxRef(),
    vehicleId: text("vehicle_id").notNull(),
    driverId: text("driver_id").notNull(),
    mode: text("mode").$type<VehicleMode>().notNull(),
    /** End of a timed mode (break, rest, handling, waiting, stopped). */
    modeUntil: ts("mode_until"),
    /** When the current mode began. */
    modeStartedAt: ts("mode_started_at"),
    /** Mode to return to after a break/rest/stop. */
    resumeMode: text("resume_mode").$type<VehicleMode | null>(),
    routeKey: text("route_key"),
    /** Base (car-profile) seconds already covered on `routeKey`. */
    progressS: doublePrecision("progress_s").notNull().default(0),
    legPurpose: text("leg_purpose").$type<LegPurpose | null>(),
    orderId: text("order_id"),
    pointId: text("point_id"),
    continuousMin: doublePrecision("continuous_min").notNull().default(0),
    dailyMin: doublePrecision("daily_min").notNull().default(0),
    splitFirstPart: boolean("split_first_part").notNull().default(false),
    extensionsUsed: integer("extensions_used").notNull().default(0),
    reportPhaseS: integer("report_phase_s").notNull().default(0),
    lastReportAt: ts("last_report_at"),
    lastReportLng: doublePrecision("last_report_lng"),
    lastReportLat: doublePrecision("last_report_lat"),
    lastReportProgressS: doublePrecision("last_report_progress_s"),
    currentActivityId: text("current_activity_id"),
    reroutedFrom: text("rerouted_from"),
    /** Extra handling minutes waiting to be applied at the next/current stop (ramp waits). */
    pendingExtraMin: integer("pending_extra_min").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.vehicleId] })],
);

export type IncidentKind = "traffic_accident" | "ramp_wait" | "breakdown" | "road_check";

export const incidents = pgTable(
  "incidents",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    kind: text("kind").$type<IncidentKind>().notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** Area incidents (traffic): centre and radius; vehicle incidents: vehicleId. */
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    radiusM: integer("radius_m"),
    /** Speed multiplier inside the area (0.1 = ten times slower). */
    speedFactor: doublePrecision("speed_factor"),
    vehicleId: text("vehicle_id"),
    extraMinutes: integer("extra_minutes"),
    alternativeRouteKey: text("alternative_route_key"),
    startSim: ts("start_sim").notNull(),
    endSim: ts("end_sim"),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] })],
);

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertStatus = "open" | "acknowledged" | "resolved";
export const ALERT_ACTIONS = [
  "pokaz_objazd",
  "zastosuj_objazd",
  "powiadom_klienta",
  "napisz_do_kierowcy",
  "przydziel_innego",
  "otworz_dokument",
  "otworz_mail",
  "otworz_przesylke",
  "brak",
] as const;
export type AlertAction = (typeof ALERT_ACTIONS)[number];

export const alerts = pgTable(
  "alerts",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    severity: text("severity").$type<AlertSeverity>().notNull(),
    vehicleId: text("vehicle_id"),
    orderId: text("order_id"),
    driverId: text("driver_id"),
    messageId: text("message_id"),
    incidentId: text("incident_id"),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    bodySource: text("body_source").$type<"ai" | "template">().notNull().default("template"),
    actions: jsonb("actions").$type<AlertAction[]>().notNull().default(sql`'[]'::jsonb`),
    facts: jsonb("facts").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    status: text("status").$type<AlertStatus>().notNull().default("open"),
    createdSim: ts("created_sim").notNull(),
    resolvedSim: ts("resolved_sim"),
  },
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.id] }),
    index("alerts_status_idx").on(t.sandboxId, t.status),
    index("alerts_dedupe_idx").on(t.sandboxId, t.dedupeKey),
  ],
);

export const DRIVER_MESSAGE_CATEGORIES = [
  "potwierdzenie",
  "odmowa",
  "warunek_pytanie",
  "operacyjne",
  "dokument",
  "luzne",
  "niejasne",
] as const;
export type DriverMessageCategory = (typeof DRIVER_MESSAGE_CATEGORIES)[number];
export type MessagePriority = "wysoki" | "normalny" | "niski";

export const messages = pgTable(
  "messages",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    /** "phone": the forwarder's note after a call (not a message the driver receives). */
    channel: text("channel").$type<"sms" | "mms" | "email" | "phone">().notNull(),
    direction: text("direction").$type<"in" | "out">().notNull(),
    party: text("party").$type<"driver" | "client" | "agent">().notNull(),
    driverId: text("driver_id"),
    clientContactId: text("client_contact_id"),
    /** Freight agent (Sales module): RFQs, rate replies, negotiations. */
    agentId: text("agent_id"),
    threadKey: text("thread_key").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    /** Sample image ids or { notStored: true } markers. */
    attachments: jsonb("attachments").$type<{ sampleId?: string; notStored?: boolean; name?: string }[]>().notNull().default(sql`'[]'::jsonb`),
    state: text("state").$type<"draft" | "sent" | "received">().notNull(),
    sentBy: text("sent_by").$type<"dispatcher" | "system" | "driver" | "client" | "agent">().notNull(),
    atSim: ts("at_sim").notNull(),
    readAtSim: ts("read_at_sim"),
    orderId: text("order_id"),
    aiCategory: text("ai_category"),
    aiSubtype: text("ai_subtype"),
    aiPriority: text("ai_priority").$type<MessagePriority | null>(),
    aiSummary: text("ai_summary"),
    aiSuggestedReplies: jsonb("ai_suggested_replies").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    aiConfidence: doublePrecision("ai_confidence"),
    aiExtracted: jsonb("ai_extracted").$type<Record<string, unknown> | null>(),
    classifiedBy: text("classified_by").$type<"ai" | "rules" | null>(),
    /** Free-form purpose tag for system messages (order, reminder, cancellation, cmr_resend…). */
    kind: text("kind"),
  },
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.id] }),
    index("messages_thread_idx").on(t.sandboxId, t.threadKey, t.atSim),
  ],
);

export type DocumentStatus = "do_zamkniecia" | "do_weryfikacji" | "nieczytelny" | "zatwierdzony" | "odrzucony";

export const documents = pgTable(
  "documents",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    messageId: text("message_id"),
    driverId: text("driver_id"),
    kind: text("kind").$type<"cmr">().notNull().default("cmr"),
    /** Sample id from public/cmr-samples, or null when the visitor's own photo was not stored. */
    imageRef: text("image_ref"),
    extracted: jsonb("extracted").$type<Record<string, unknown> | null>(),
    quality: jsonb("quality").$type<{ legible: boolean; stamp: boolean | null; signature: boolean | null; remarks: string | null } | null>(),
    matchCandidates: jsonb("match_candidates").$type<{ orderId: string; number: string; score: number; reasons: string[] }[]>().notNull().default(sql`'[]'::jsonb`),
    matchedOrderId: text("matched_order_id"),
    matchScore: doublePrecision("match_score"),
    status: text("status").$type<DocumentStatus>().notNull(),
    readBy: text("read_by").$type<"ai" | "fallback">(),
    note: text("note"),
    decidedBy: text("decided_by").$type<"dispatcher" | "ai" | null>(),
    decidedAtSim: ts("decided_at_sim"),
    createdSim: ts("created_sim").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.id] }),
    index("documents_status_idx").on(t.sandboxId, t.status),
  ],
);

// ——— Sales (quotes via freight agents, road quotes for the own fleet) ———

export const QUOTE_MODES = ["sea", "air", "rail", "road"] as const;
export type QuoteMode = (typeof QUOTE_MODES)[number];
export type QuoteStatus = "niekompletne" | "do_zatwierdzenia" | "zbieranie" | "gotowe" | "oferta_wyslana" | "wygrana" | "przegrana" | "anulowana";

/** Trusted freight agents (people at partner forwarders, not AI agents). */
export const agents = pgTable(
  "agents",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    company: text("company").notNull(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    modes: jsonb("modes").$type<QuoteMode[]>().notNull(),
    regions: text("regions").notNull().default(""),
    active: boolean("active").notNull().default(true),
    /** Bot behaviour in the demo: how often and how fast this agent answers. */
    replyRate: doublePrecision("reply_rate").notNull().default(0.75),
    priceFactor: doublePrecision("price_factor").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] })],
);

export const quoteRequests = pgTable(
  "quote_requests",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    number: text("number").notNull(),
    mode: text("mode").$type<QuoteMode>().notNull(),
    status: text("status").$type<QuoteStatus>().notNull(),
    clientId: text("client_id").notNull(),
    contactId: text("contact_id").notNull(),
    sourceMessageId: text("source_message_id"),
    /** What was read from the client's e-mail (origin, destination, incoterms, cargo…). */
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    missingFields: jsonb("missing_fields").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    extractedBy: text("extracted_by").$type<"ai" | "rules">().notNull(),
    selectedQuoteId: text("selected_quote_id"),
    marginPct: doublePrecision("margin_pct"),
    /** Road quotes: the calculation shown to the salesperson. */
    calculation: jsonb("calculation").$type<Record<string, unknown> | null>(),
    deadlineSim: ts("deadline_sim"),
    createdSim: ts("created_sim").notNull(),
    closedSim: ts("closed_sim"),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] }), index("quote_requests_status_idx").on(t.sandboxId, t.status)],
);

export type AgentQuoteStatus = "wyslane" | "przypomniane" | "odpowiedz" | "brak_miejsca" | "brak_odpowiedzi";

export const agentQuotes = pgTable(
  "agent_quotes",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    requestId: text("request_id").notNull(),
    agentId: text("agent_id").notNull(),
    status: text("status").$type<AgentQuoteStatus>().notNull(),
    price: doublePrecision("price"),
    currency: text("currency"),
    validUntil: text("valid_until"),
    transitDays: integer("transit_days"),
    conditions: text("conditions"),
    readBy: text("read_by").$type<"ai" | "rules" | null>(),
    sentSim: ts("sent_sim").notNull(),
    repliedSim: ts("replied_sim"),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] }), index("agent_quotes_request_idx").on(t.sandboxId, t.requestId)],
);

export type RoadRate = { kind: "bus" | "solo" | "tractor"; label: string; perKmPln: number; perKmEur: number; minPln: number; minEur: number };

/** One row per world: automation switch, default margin and road rates. */
export const salesSettings = pgTable("sales_settings", {
  sandboxId: sandboxRef().primaryKey(),
  autoSend: boolean("auto_send").notNull().default(true),
  defaultMarginPct: doublePrecision("default_margin_pct").notNull().default(12),
  adrSurchargePct: doublePrecision("adr_surcharge_pct").notNull().default(15),
  reeferSurchargePct: doublePrecision("reefer_surcharge_pct").notNull().default(20),
  roadRates: jsonb("road_rates").$type<RoadRate[]>().notNull(),
});

/**
 * Client tracking links (stage 5): one random token per shared order. The token
 * is the only key a client has, so it is globally unique and unguessable.
 */
export const trackingLinks = pgTable(
  "tracking_links",
  {
    token: text("token").primaryKey(),
    sandboxId: sandboxRef(),
    orderId: text("order_id").notNull(),
    clientId: text("client_id").notNull(),
    extendedMinutes: integer("extended_minutes").notNull().default(0),
    revoked: boolean("revoked").notNull().default(false),
    createdSim: ts("created_sim").notNull(),
  },
  (t) => [index("tracking_links_order_idx").on(t.sandboxId, t.orderId)],
);

// ——— Fleet file and driver calendar (stage 6) ———

export const TERM_KINDS = ["przeglad", "oc", "tachograf", "serwis", "atp", "prawo_jazdy", "kwalifikacja", "karta_kierowcy", "badania", "adr"] as const;
export type TermKind = (typeof TERM_KINDS)[number];

/** Deadlines of vehicles, trailers and drivers: by date or by odometer. */
export const fleetTerms = pgTable(
  "fleet_terms",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    subjectType: text("subject_type").$type<"vehicle" | "trailer" | "driver">().notNull(),
    subjectId: text("subject_id").notNull(),
    kind: text("kind").$type<TermKind>().notNull(),
    dueSim: ts("due_sim"),
    dueKm: integer("due_km"),
    docNumber: text("doc_number").notNull().default(""),
    /** An overdue blocking term excludes the vehicle/driver from new orders. */
    blocking: boolean("blocking").notNull().default(false),
    doneSim: ts("done_sim"),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] }), index("fleet_terms_subject_idx").on(t.sandboxId, t.subjectId)],
);

export const ABSENCE_KINDS = ["urlop", "l4", "szkolenie", "badania", "wolne"] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

export const driverAbsences = pgTable(
  "driver_absences",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    driverId: text("driver_id").notNull(),
    kind: text("kind").$type<AbsenceKind>().notNull(),
    fromSim: ts("from_sim").notNull(),
    toSim: ts("to_sim").notNull(),
    note: text("note").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] }), index("driver_absences_driver_idx").on(t.sandboxId, t.driverId)],
);

// ——— Order templates and recurring orders (stage 4) ———

export const orderTemplates = pgTable(
  "order_templates",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    clientId: text("client_id").notNull(),
    pickupPointId: text("pickup_point_id").notNull(),
    deliveryPointId: text("delivery_point_id").notNull(),
    /** Windows as minutes after local midnight; delivery may be on a later day. */
    pickupFromMin: integer("pickup_from_min").notNull(),
    pickupToMin: integer("pickup_to_min").notNull(),
    deliveryDayOffset: integer("delivery_day_offset").notNull().default(0),
    deliveryFromMin: integer("delivery_from_min").notNull(),
    deliveryToMin: integer("delivery_to_min").notNull(),
    cargoPallets: integer("cargo_pallets").notNull(),
    cargoKg: integer("cargo_kg").notNull(),
    bodyRequired: text("body_required").$type<"plandeka" | "chlodnia" | "skrzynia" | null>(),
    adrRequired: boolean("adr_required").notNull().default(false),
    references: jsonb("references").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    notes: text("notes").notNull().default(""),
    /** ISO weekdays 1 (Mon) … 7 (Sun). */
    weekdays: jsonb("weekdays").$type<number[]>().notNull(),
    /** Who usually drives it: orders made from the plan go to this driver when they fit. */
    defaultDriverId: text("default_driver_id"),
    active: boolean("active").notNull().default(true),
    /** Deleted by the dispatcher: kept so an emptied list is not mistaken for a never-seeded world. */
    archived: boolean("archived").notNull().default(false),
    createdSim: ts("created_sim").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] })],
);

export type ShipmentStatus = "planowana" | "w_drodze" | "dostarczona" | "anulowana";

/**
 * Sea, air and rail shipments handled by partner agents (module C). What the forwarder
 * knows comes from agent replies (milestones, ETA); live positions are not connected
 * in the demo (see docs/sledzenie-przesylek.md).
 */
export const shipments = pgTable(
  "shipments",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    number: text("number").notNull(),
    mode: text("mode").$type<"sea" | "air" | "rail">().notNull(),
    status: text("status").$type<ShipmentStatus>().notNull(),
    clientId: text("client_id").notNull(),
    contactId: text("contact_id"),
    agentId: text("agent_id").notNull(),
    quoteId: text("quote_id"),
    originId: text("origin_id").notNull(),
    destinationId: text("destination_id").notNull(),
    /** Optional middle stop: sea/air transshipment or rail border crossing. */
    middleName: text("middle_name"),
    middleFraction: doublePrecision("middle_fraction"),
    path: jsonb("path").$type<[number, number][]>().notNull(),
    incoterms: text("incoterms").notNull().default(""),
    cargo: text("cargo").notNull().default(""),
    pieces: integer("pieces"),
    weightKg: integer("weight_kg"),
    volumeCbm: doublePrecision("volume_cbm"),
    /** Booking, B/L or AWB, containers, vessel/flight/train, client reference. */
    refs: jsonb("refs").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    etdPlanned: ts("etd_planned").notNull(),
    etaPlanned: ts("eta_planned").notNull(),
    /** Latest ETA as known from the agent. */
    etaCurrent: ts("eta_current").notNull(),
    /** Latest explanation from the agent (delay reason, remarks), shown to the forwarder. */
    statusNote: text("status_note").notNull().default(""),
    /** Demo only: how reality differs from the plan (hours of delay per stage, and why). Agent bots report it. */
    truth: jsonb("truth").$type<{ departureDelayH: number; middleDelayH: number; arrivalDelayH: number; reason: string; reasonEn?: string }>().notNull(),
    agentEveryHours: integer("agent_every_hours").notNull(),
    lastAgentRequestSim: ts("last_agent_request_sim"),
    agentAwaitingReply: boolean("agent_awaiting_reply").notNull().default(false),
    /** When the unanswered request was followed by a reminder (null: no reminder yet). */
    agentRemindedSim: ts("agent_reminded_sim"),
    clientEveryHours: integer("client_every_hours").notNull(),
    nextClientUpdateSim: ts("next_client_update_sim"),
    lastClientUpdateSim: ts("last_client_update_sim"),
    /** Opt-in per shipment: the AI draft goes to the client without a click (if it passes the leak guard). */
    autoClientUpdates: boolean("auto_client_updates").notNull().default(false),
    createdSim: ts("created_sim").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.id] }),
    index("shipments_status_idx").on(t.sandboxId, t.status),
    uniqueIndex("shipments_number_uq").on(t.sandboxId, t.number),
    // One shipment per won quote (NULLs — shipments made by hand — do not collide).
    uniqueIndex("shipments_quote_uq").on(t.sandboxId, t.quoteId),
  ],
);

export const shipmentMilestones = pgTable(
  "shipment_milestones",
  {
    sandboxId: sandboxRef(),
    id: text("id").notNull(),
    shipmentId: text("shipment_id").notNull(),
    seq: integer("seq").notNull(),
    kind: text("kind").$type<"booking" | "terminal_in" | "departed" | "transshipment" | "border" | "arrived" | "customs" | "delivered">().notNull(),
    label: text("label").notNull(),
    location: text("location").notNull(),
    plannedSim: ts("planned_sim").notNull(),
    actualSim: ts("actual_sim"),
    /** Who confirmed it: the plan only, an agent reply (read by AI or rules) or the forwarder. */
    source: text("source").$type<"plan" | "agent_ai" | "agent_rules" | "dispatcher">().notNull().default("plan"),
    sourceMessageId: text("source_message_id"),
  },
  (t) => [primaryKey({ columns: [t.sandboxId, t.id] }), index("shipment_milestones_shipment_idx").on(t.sandboxId, t.shipmentId)],
);

/** Global (not per world) daily AI spend, used for the daily budget cap. */
export const aiBudgetDaily = pgTable("ai_budget_daily", {
  day: text("day").primaryKey(),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  calls: integer("calls").notNull().default(0),
});
