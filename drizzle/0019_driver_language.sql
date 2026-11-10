ALTER TABLE "drivers" ADD COLUMN "language" text DEFAULT 'pl' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "translation" text;