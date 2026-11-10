CREATE TABLE "point_note_suggestions" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"point_id" text NOT NULL,
	"text" text NOT NULL,
	"message_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'nowa' NOT NULL,
	"created_sim" timestamp with time zone NOT NULL,
	"decided_sim" timestamp with time zone,
	CONSTRAINT "point_note_suggestions_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "point_note_suggestions" ADD CONSTRAINT "point_note_suggestions_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "point_note_suggestions_point_idx" ON "point_note_suggestions" USING btree ("sandbox_id","point_id","status");