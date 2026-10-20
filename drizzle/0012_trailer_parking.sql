ALTER TABLE "trailers" ADD COLUMN "parked_at_point_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "couplings_open_vehicle_uq" ON "couplings" USING btree ("sandbox_id","vehicle_id") WHERE "couplings"."to_sim" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "couplings_open_trailer_uq" ON "couplings" USING btree ("sandbox_id","trailer_id") WHERE "couplings"."to_sim" is null;--> statement-breakpoint
-- Worlds created before this migration: the two spare trailers of the scenario stand at their bases.
UPDATE "trailers" SET "parked_at_point_id" = 'pt-baza-poznan' WHERE "id" = 'tr-po11rs';--> statement-breakpoint
UPDATE "trailers" SET "parked_at_point_id" = 'pt-baza-wroclaw' WHERE "id" = 'tr-dw55bt';
