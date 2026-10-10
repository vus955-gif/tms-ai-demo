CREATE TABLE "ai_budget_daily" (
	"day" text PRIMARY KEY NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_log" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"fn" text NOT NULL,
	"model" text NOT NULL,
	"input_ref" text DEFAULT '' NOT NULL,
	"output" jsonb,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"reason" text,
	"error" text,
	"at_sim" timestamp with time zone NOT NULL,
	"created_real" timestamp with time zone DEFAULT now() NOT NULL,
	"action_taken" text,
	"reverted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ai_log_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	CONSTRAINT "client_contacts_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"tax_id" text NOT NULL,
	"email_domain" text NOT NULL,
	"is_key" boolean DEFAULT false NOT NULL,
	CONSTRAINT "clients_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "couplings" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"trailer_id" text NOT NULL,
	"from_sim" timestamp with time zone NOT NULL,
	"to_sim" timestamp with time zone,
	CONSTRAINT "couplings_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "driver_activities" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"driver_id" text NOT NULL,
	"type" text NOT NULL,
	"start_sim" timestamp with time zone NOT NULL,
	"end_sim" timestamp with time zone,
	"source" text NOT NULL,
	CONSTRAINT "driver_activities_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "driver_client_history" (
	"sandbox_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"client_id" text NOT NULL,
	"completed_orders" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "driver_client_history_sandbox_id_driver_id_client_id_pk" PRIMARY KEY("sandbox_id","driver_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"adr_certificate" boolean DEFAULT false NOT NULL,
	"vehicle_id" text,
	"refusal_propensity" double precision DEFAULT 0.1 NOT NULL,
	"extensions_used_this_week" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "drivers_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "order_status_changes" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"order_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"at_sim" timestamp with time zone NOT NULL,
	CONSTRAINT "order_status_changes_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"number" text NOT NULL,
	"client_id" text NOT NULL,
	"pickup_point_id" text NOT NULL,
	"pickup_from" timestamp with time zone NOT NULL,
	"pickup_to" timestamp with time zone NOT NULL,
	"delivery_point_id" text NOT NULL,
	"delivery_from" timestamp with time zone NOT NULL,
	"delivery_to" timestamp with time zone NOT NULL,
	"cargo_pallets" integer NOT NULL,
	"cargo_kg" integer NOT NULL,
	"body_required" text,
	"adr_required" boolean DEFAULT false NOT NULL,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"driver_id" text,
	"vehicle_id" text,
	"trailer_id" text,
	"etd" timestamp with time zone,
	"eta_agreed" timestamp with time zone,
	"source" text NOT NULL,
	"source_message_id" text,
	"created_sim" timestamp with time zone NOT NULL,
	CONSTRAINT "orders_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "points" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"client_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"country" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"opening_hours" text NOT NULL,
	"requirements" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"handling_minutes" integer DEFAULT 45 NOT NULL,
	CONSTRAINT "points_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "sandboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"seed" integer NOT NULL,
	"random_run" boolean DEFAULT false NOT NULL,
	"sim_origin" timestamp with time zone NOT NULL,
	"sim_elapsed_ms" bigint DEFAULT 0 NOT NULL,
	"running" boolean DEFAULT true NOT NULL,
	"speed" integer DEFAULT 10 NOT NULL,
	"real_resumed_at" timestamp with time zone NOT NULL,
	"last_tick_sim" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"ip_hash" text NOT NULL,
	"ai_window_start" timestamp with time zone,
	"ai_calls_in_window" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_events" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"due_sim" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at_sim" timestamp with time zone,
	CONSTRAINT "scheduled_events_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "trailers" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"plates" text NOT NULL,
	"body" text NOT NULL,
	"capacity_pallets" integer NOT NULL,
	"capacity_kg" integer NOT NULL,
	"adr" boolean DEFAULT false NOT NULL,
	CONSTRAINT "trailers_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"plates" text NOT NULL,
	"body" text,
	"capacity_pallets" integer DEFAULT 0 NOT NULL,
	"capacity_kg" integer DEFAULT 0 NOT NULL,
	"adr" boolean DEFAULT false NOT NULL,
	"subject_to_561" boolean NOT NULL,
	"international" boolean DEFAULT false NOT NULL,
	"odometer_km" integer NOT NULL,
	"home_point_id" text NOT NULL,
	"current_point_id" text,
	CONSTRAINT "vehicles_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "ai_log" ADD CONSTRAINT "ai_log_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "couplings" ADD CONSTRAINT "couplings_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_activities" ADD CONSTRAINT "driver_activities_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_client_history" ADD CONSTRAINT "driver_client_history_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_changes" ADD CONSTRAINT "order_status_changes_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "points_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trailers" ADD CONSTRAINT "trailers_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_log_created_idx" ON "ai_log" USING btree ("sandbox_id","created_real");--> statement-breakpoint
CREATE INDEX "driver_activities_driver_idx" ON "driver_activities" USING btree ("sandbox_id","driver_id","start_sim");--> statement-breakpoint
CREATE INDEX "order_status_changes_order_idx" ON "order_status_changes" USING btree ("sandbox_id","order_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("sandbox_id","status");--> statement-breakpoint
CREATE INDEX "orders_driver_idx" ON "orders" USING btree ("sandbox_id","driver_id");--> statement-breakpoint
CREATE INDEX "scheduled_events_due_idx" ON "scheduled_events" USING btree ("sandbox_id","processed_at_sim","due_sim");