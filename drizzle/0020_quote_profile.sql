ALTER TABLE "clients" ADD COLUMN "quote_price_weight" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "quote_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "max_agents_per_rfq" integer DEFAULT 5 NOT NULL;