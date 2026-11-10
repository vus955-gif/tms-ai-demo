CREATE TABLE "damage_cases" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"document_id" text NOT NULL,
	"order_id" text NOT NULL,
	"kind" text NOT NULL,
	"affected" text,
	"summary" text NOT NULL,
	"remark" text NOT NULL,
	"steps" jsonb NOT NULL,
	"done_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft_message_id" text,
	"source" text NOT NULL,
	"mail_from" text NOT NULL,
	"created_sim" timestamp with time zone NOT NULL,
	CONSTRAINT "damage_cases_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "damage_cases" ADD CONSTRAINT "damage_cases_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "damage_cases_document_uq" ON "damage_cases" USING btree ("sandbox_id","document_id");