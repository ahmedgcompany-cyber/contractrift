CREATE TYPE "public"."channel_kind" AS ENUM('webhook', 'slack');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."drift_status" AS ENUM('open', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."monitor_kind" AS ENUM('http', 'llm', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."monitor_status" AS ENUM('unknown', 'up', 'down');--> statement-breakpoint
CREATE TYPE "public"."drift_severity" AS ENUM('breaking', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('viewer', 'editor', 'admin');--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"monitor_id" uuid PRIMARY KEY NOT NULL,
	"shape" jsonb NOT NULL,
	"signature" jsonb NOT NULL,
	"locked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"monitor_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"ok" boolean NOT NULL,
	"status_code" integer,
	"error_code" text,
	"message" text,
	"assertions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_excerpt" text
);
--> statement-breakpoint
CREATE TABLE "drift_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"severity" "drift_severity" NOT NULL,
	"fingerprint" text NOT NULL,
	"changes" jsonb NOT NULL,
	"observed_shape" jsonb NOT NULL,
	"observed_signature" jsonb NOT NULL,
	"status" "drift_status" DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"cause" text NOT NULL,
	"last_error" text,
	"failure_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "monitor_kind" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"interval_seconds" integer DEFAULT 300 NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"failure_threshold" integer DEFAULT 2 NOT NULL,
	"baseline_samples" integer DEFAULT 3 NOT NULL,
	"drift_enabled" boolean DEFAULT true NOT NULL,
	"ignore_paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"config" jsonb NOT NULL,
	"secrets_enc" text,
	"status" "monitor_status" DEFAULT 'unknown' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_duration_ms" integer,
	"last_error" text,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "channel_kind" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"events" text[] NOT NULL,
	"config_enc" text NOT NULL,
	"target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"response_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_events" ADD CONSTRAINT "drift_events_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_events" ADD CONSTRAINT "drift_events_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_idx" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_time_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "check_results_monitor_time_idx" ON "check_results" USING btree ("monitor_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "check_results_time_idx" ON "check_results" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "drift_events_monitor_idx" ON "drift_events" USING btree ("monitor_id","detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "drift_events_status_idx" ON "drift_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "drift_events_fingerprint_idx" ON "drift_events" USING btree ("monitor_id","fingerprint");--> statement-breakpoint
CREATE INDEX "incidents_monitor_idx" ON "incidents" USING btree ("monitor_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_one_open_per_monitor" ON "incidents" USING btree ("monitor_id") WHERE "incidents"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "monitors_due_idx" ON "monitors" USING btree ("next_run_at") WHERE "monitors"."enabled";--> statement-breakpoint
CREATE INDEX "monitors_status_idx" ON "monitors" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deliveries_pending_idx" ON "notification_deliveries" USING btree ("next_attempt_at") WHERE "notification_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "deliveries_channel_idx" ON "notification_deliveries" USING btree ("channel_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));