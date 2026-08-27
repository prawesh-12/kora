CREATE TABLE "shadow_comparisons" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"run_id" text NOT NULL,
	"proposed_action" text,
	"proposed_amount_minor" bigint,
	"actual_action" text,
	"actual_amount_minor" bigint,
	"agreement" text NOT NULL,
	"value_at_risk_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"version_id" text NOT NULL,
	"from_version_id" text,
	"kind" text NOT NULL,
	"benchmark_run_id" text,
	"replay_run_id" text,
	"accepted_regressions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "max_actions_per_day" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "max_value_minor_per_action" bigint;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "max_value_minor_per_day" bigint;--> statement-breakpoint
ALTER TABLE "shadow_comparisons" ADD CONSTRAINT "shadow_comparisons_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shadow_comparisons" ADD CONSTRAINT "shadow_comparisons_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_version_id_agent_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shadow_tenant_created_idx" ON "shadow_comparisons" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "shadow_tenant_agreement_idx" ON "shadow_comparisons" USING btree ("tenant_id","agreement");--> statement-breakpoint
CREATE INDEX "shadow_value_idx" ON "shadow_comparisons" USING btree ("tenant_id","value_at_risk_minor");--> statement-breakpoint
CREATE INDEX "promotions_tenant_created_idx" ON "promotions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "promotions_version_idx" ON "promotions" USING btree ("version_id");