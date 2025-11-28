ALTER TABLE "sessions" ADD COLUMN "device_id" varchar(255);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "product" varchar(255);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device" varchar(255);--> statement-breakpoint
CREATE INDEX "sessions_device_idx" ON "sessions" USING btree ("user_id","device_id");