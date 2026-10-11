CREATE TABLE "tracking_links" (
	"token" text PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"order_id" text NOT NULL,
	"client_id" text NOT NULL,
	"extended_minutes" integer DEFAULT 0 NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_sim" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracking_links_order_idx" ON "tracking_links" USING btree ("sandbox_id","order_id");