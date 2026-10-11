CREATE TABLE "documents" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"message_id" text,
	"driver_id" text,
	"kind" text DEFAULT 'cmr' NOT NULL,
	"image_ref" text,
	"extracted" jsonb,
	"quality" jsonb,
	"match_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_order_id" text,
	"match_score" double precision,
	"status" text NOT NULL,
	"read_by" text,
	"note" text,
	"decided_by" text,
	"decided_at_sim" timestamp with time zone,
	"created_sim" timestamp with time zone NOT NULL,
	CONSTRAINT "documents_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("sandbox_id","status");