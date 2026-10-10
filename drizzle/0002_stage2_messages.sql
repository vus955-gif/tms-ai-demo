CREATE TABLE "messages" (
	"sandbox_id" text NOT NULL,
	"id" text NOT NULL,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"party" text NOT NULL,
	"driver_id" text,
	"client_contact_id" text,
	"thread_key" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text NOT NULL,
	"sent_by" text NOT NULL,
	"at_sim" timestamp with time zone NOT NULL,
	"read_at_sim" timestamp with time zone,
	"order_id" text,
	"ai_category" text,
	"ai_subtype" text,
	"ai_priority" text,
	"ai_summary" text,
	"ai_suggested_replies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_confidence" double precision,
	"ai_extracted" jsonb,
	"classified_by" text,
	"kind" text,
	CONSTRAINT "messages_sandbox_id_id_pk" PRIMARY KEY("sandbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "phone_driver_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("sandbox_id","thread_key","at_sim");