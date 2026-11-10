CREATE TABLE "handovers" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"body" text NOT NULL,
	"facts" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_sim" timestamp with time zone NOT NULL,
	CONSTRAINT "handovers_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handovers_created_idx" ON "handovers" USING btree ("sandbox_id","created_sim");