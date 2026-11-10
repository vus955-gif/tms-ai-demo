CREATE TABLE "driver_links" (
	"token" text PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"order_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"created_sim" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_links" ADD CONSTRAINT "driver_links_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_links_order_idx" ON "driver_links" USING btree ("sandbox_id","order_id");