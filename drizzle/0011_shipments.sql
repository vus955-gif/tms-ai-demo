CREATE TABLE "shipment_milestones" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"location" text NOT NULL,
	"planned_sim" timestamp with time zone NOT NULL,
	"actual_sim" timestamp with time zone,
	"source" text DEFAULT 'plan' NOT NULL,
	"source_message_id" text,
	CONSTRAINT "shipment_milestones_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"number" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"client_id" text NOT NULL,
	"contact_id" text,
	"agent_id" text NOT NULL,
	"quote_id" text,
	"origin_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"middle_name" text,
	"middle_fraction" double precision,
	"path" jsonb NOT NULL,
	"incoterms" text DEFAULT '' NOT NULL,
	"cargo" text DEFAULT '' NOT NULL,
	"pieces" integer,
	"weight_kg" integer,
	"volume_cbm" double precision,
	"refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"etd_planned" timestamp with time zone NOT NULL,
	"eta_planned" timestamp with time zone NOT NULL,
	"eta_current" timestamp with time zone NOT NULL,
	"status_note" text DEFAULT '' NOT NULL,
	"truth" jsonb NOT NULL,
	"agent_every_hours" integer NOT NULL,
	"last_agent_request_sim" timestamp with time zone,
	"agent_awaiting_reply" boolean DEFAULT false NOT NULL,
	"agent_reminded_sim" timestamp with time zone,
	"client_every_hours" integer NOT NULL,
	"next_client_update_sim" timestamp with time zone,
	"last_client_update_sim" timestamp with time zone,
	"auto_client_updates" boolean DEFAULT false NOT NULL,
	"created_sim" timestamp with time zone NOT NULL,
	CONSTRAINT "shipments_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "shipment_milestones" ADD CONSTRAINT "shipment_milestones_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipment_milestones_shipment_idx" ON "shipment_milestones" USING btree ("sandbox_id","shipment_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("sandbox_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_number_uq" ON "shipments" USING btree ("sandbox_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_quote_uq" ON "shipments" USING btree ("sandbox_id","quote_id");