CREATE TABLE "change_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" integer NOT NULL,
	"kind" text NOT NULL,
	"audience" text NOT NULL,
	"items" jsonb NOT NULL,
	CONSTRAINT "change_entries_kind_check" CHECK ("change_entries"."kind" IN ('feature','improvement','fix')),
	CONSTRAINT "change_entries_audience_check" CHECK ("change_entries"."audience" IN ('everyone','admins'))
);
--> statement-breakpoint
CREATE TABLE "change_releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text,
	"commit" text,
	"deployed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "update_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"channel" text,
	"from_version" text,
	"to_version" text,
	"message" text,
	CONSTRAINT "update_events_status_check" CHECK ("update_events"."status" IN ('updated','rolled_back','failed'))
);
--> statement-breakpoint
CREATE TABLE "update_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"channel" text DEFAULT 'manual' NOT NULL,
	"update_hour" integer DEFAULT 3 NOT NULL,
	"update_requested_at" timestamp with time zone,
	"update_requested_by" uuid,
	"host_last_seen_at" timestamp with time zone,
	"last_report" jsonb,
	"pending_changes" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "update_settings_singleton" CHECK ("update_settings"."id"),
	CONSTRAINT "update_settings_channel_check" CHECK ("update_settings"."channel" IN ('production','development','manual')),
	CONSTRAINT "update_settings_hour_check" CHECK ("update_settings"."update_hour" BETWEEN 0 AND 23)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whats_new_seen_release_id" integer;--> statement-breakpoint
ALTER TABLE "change_entries" ADD CONSTRAINT "change_entries_release_id_change_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."change_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_settings" ADD CONSTRAINT "update_settings_update_requested_by_users_id_fk" FOREIGN KEY ("update_requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_settings" ADD CONSTRAINT "update_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_entries_release_idx" ON "change_entries" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "update_events_at_idx" ON "update_events" USING btree ("at");