CREATE TABLE "alerts" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"vehicle_id" text,
	"order_id" text,
	"driver_id" text,
	"message_id" text,
	"incident_id" text,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"body_source" text DEFAULT 'template' NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_sim" timestamp with time zone NOT NULL,
	"resolved_sim" timestamp with time zone,
	CONSTRAINT "alerts_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"radius_m" integer,
	"speed_factor" double precision,
	"vehicle_id" text,
	"extra_minutes" integer,
	"alternative_route_key" text,
	"start_sim" timestamp with time zone NOT NULL,
	"end_sim" timestamp with time zone,
	CONSTRAINT "incidents_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_states" (
	"sandbox_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"mode" text NOT NULL,
	"mode_until" timestamp with time zone,
	"resume_mode" text,
	"route_key" text,
	"progress_s" double precision DEFAULT 0 NOT NULL,
	"leg_purpose" text,
	"order_id" text,
	"point_id" text,
	"continuous_min" double precision DEFAULT 0 NOT NULL,
	"daily_min" double precision DEFAULT 0 NOT NULL,
	"split_first_part" boolean DEFAULT false NOT NULL,
	"extensions_used" integer DEFAULT 0 NOT NULL,
	"report_phase_s" integer DEFAULT 0 NOT NULL,
	"last_report_at" timestamp with time zone,
	"last_report_lng" double precision,
	"last_report_lat" double precision,
	"last_report_progress_s" double precision,
	"current_activity_id" text,
	"rerouted_from" text,
	"pending_extra_min" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "vehicle_states_sandbox_id_vehicle_id_pk" PRIMARY KEY("sandbox_id","vehicle_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "arrived_pickup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "departed_pickup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "arrived_delivery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "unloaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "eta_predicted" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "risk" text;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_states" ADD CONSTRAINT "vehicle_states_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("sandbox_id","status");--> statement-breakpoint
CREATE INDEX "alerts_dedupe_idx" ON "alerts" USING btree ("sandbox_id","dedupe_key");