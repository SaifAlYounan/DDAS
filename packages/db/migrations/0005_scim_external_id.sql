ALTER TABLE "principals" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "principals_external_id_uq" ON "principals" USING btree ("external_id");
