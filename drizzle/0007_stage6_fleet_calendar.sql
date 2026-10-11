CREATE TABLE "driver_absences" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"driver_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_sim" timestamp with time zone NOT NULL,
	"to_sim" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "driver_absences_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
CREATE TABLE "fleet_terms" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"kind" text NOT NULL,
	"due_sim" timestamp with time zone,
	"due_km" integer,
	"doc_number" text DEFAULT '' NOT NULL,
	"blocking" boolean DEFAULT false NOT NULL,
	"done_sim" timestamp with time zone,
	CONSTRAINT "fleet_terms_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "driver_absences" ADD CONSTRAINT "driver_absences_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_terms" ADD CONSTRAINT "fleet_terms_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_absences_driver_idx" ON "driver_absences" USING btree ("sandbox_id","driver_id");--> statement-breakpoint
CREATE INDEX "fleet_terms_subject_idx" ON "fleet_terms" USING btree ("sandbox_id","subject_id");