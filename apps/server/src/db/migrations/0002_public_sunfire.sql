ALTER TABLE "refresh_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "refresh_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "rating_key" varchar(255);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "external_session_id" varchar(255);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "total_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "progress_ms" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tautulli_url" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tautulli_api_key" text;--> statement-breakpoint
CREATE INDEX "sessions_external_session_idx" ON "sessions" USING btree ("server_id","external_session_id");