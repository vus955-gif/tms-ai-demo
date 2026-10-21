ALTER TABLE "order_templates" ADD COLUMN "default_driver_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "sms_due_sim" timestamp with time zone;--> statement-breakpoint
-- Demo templates of older worlds get the same usual drivers as new worlds.
UPDATE "order_templates" SET "default_driver_id" = 'd-dabrowski' WHERE "id" = 'tpl-agropol-pasza' AND "default_driver_id" IS NULL;--> statement-breakpoint
UPDATE "order_templates" SET "default_driver_id" = 'd-wisniewska' WHERE "id" = 'tpl-baltic-chlodnia' AND "default_driver_id" IS NULL;
