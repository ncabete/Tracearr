ALTER TABLE "settings" ADD COLUMN "poller_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "poller_interval_ms" integer DEFAULT 15000 NOT NULL;