CREATE TABLE "agent_quotes" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"request_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"status" text NOT NULL,
	"price" double precision,
	"currency" text,
	"valid_until" text,
	"transit_days" integer,
	"conditions" text,
	"read_by" text,
	"sent_sim" timestamp with time zone NOT NULL,
	"replied_sim" timestamp with time zone,
	CONSTRAINT "agent_quotes_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"company" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"modes" jsonb NOT NULL,
	"regions" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"reply_rate" double precision DEFAULT 0.75 NOT NULL,
	"price_factor" double precision DEFAULT 1 NOT NULL,
	CONSTRAINT "agents_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "quote_requests" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"number" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"client_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"source_message_id" text,
	"details" jsonb NOT NULL,
	"missing_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extracted_by" text NOT NULL,
	"selected_quote_id" text,
	"margin_pct" double precision,
	"calculation" jsonb,
	"deadline_sim" timestamp with time zone,
	"created_sim" timestamp with time zone NOT NULL,
	"closed_sim" timestamp with time zone,
	CONSTRAINT "quote_requests_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "sales_settings" (
	"sandbox_id" text PRIMARY KEY NOT NULL,
	"auto_send" boolean DEFAULT true NOT NULL,
	"default_margin_pct" double precision DEFAULT 12 NOT NULL,
	"adr_surcharge_pct" double precision DEFAULT 15 NOT NULL,
	"reefer_surcharge_pct" double precision DEFAULT 20 NOT NULL,
	"road_rates" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "agent_quotes" ADD CONSTRAINT "agent_quotes_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD CONSTRAINT "sales_settings_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_quotes_request_idx" ON "agent_quotes" USING btree ("sandbox_id","request_id");--> statement-breakpoint
CREATE INDEX "quote_requests_status_idx" ON "quote_requests" USING btree ("sandbox_id","status");