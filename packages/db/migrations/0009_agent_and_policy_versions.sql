CREATE TABLE "agent_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"model" text NOT NULL,
	"system_prompt" text NOT NULL,
	"intent_prompt" text NOT NULL,
	"allowed_tools" jsonb NOT NULL,
	"permissions" jsonb NOT NULL,
	"policy_bundle" jsonb NOT NULL,
	"rubric_version" text NOT NULL,
	"max_steps" integer NOT NULL,
	"run_deadline_ms" integer NOT NULL,
	"confidence_threshold" real NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "agent_versions_agent_version" UNIQUE("agent_id","version")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_tenant_slug" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_tenant_key" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"version" integer NOT NULL,
	"source_yaml" text NOT NULL,
	"compiled" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_policy_version" UNIQUE("policy_id","version")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "agent_version_id" text;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_versions_tenant_idx" ON "agent_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "agent_versions_agent_status_idx" ON "agent_versions" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "agents_tenant_idx" ON "agents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "policies_tenant_idx" ON "policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "policy_versions_tenant_idx" ON "policy_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "policy_versions_policy_status_idx" ON "policy_versions" USING btree ("policy_id","status");