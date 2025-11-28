ALTER TABLE "sessions" ADD COLUMN "grandparent_title" varchar(500);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "season_number" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "episode_number" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "thumb_path" varchar(500);