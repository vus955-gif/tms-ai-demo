CREATE TABLE "order_templates" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"pickup_point_id" text NOT NULL,
	"delivery_point_id" text NOT NULL,
	"pickup_from_min" integer NOT NULL,
	"pickup_to_min" integer NOT NULL,
	"delivery_day_offset" integer DEFAULT 0 NOT NULL,
	"delivery_from_min" integer NOT NULL,
	"delivery_to_min" integer NOT NULL,
	"cargo_pallets" integer NOT NULL,
	"cargo_kg" integer NOT NULL,
	"body_required" text,
	"adr_required" boolean DEFAULT false NOT NULL,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"weekdays" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_sim" timestamp with time zone NOT NULL,
	CONSTRAINT "order_templates_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "order_templates" ADD CONSTRAINT "order_templates_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;