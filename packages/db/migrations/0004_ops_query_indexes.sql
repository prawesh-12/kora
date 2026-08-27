CREATE INDEX IF NOT EXISTS "agent_runs_tenant_started_idx" ON "agent_runs" ("tenant_id","started_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_tenant_config_started_idx" ON "agent_runs" ("tenant_id","agent_config_version","started_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_tenant_intent_started_idx" ON "agent_runs" ("tenant_id","intent","started_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_tenant_outcome_started_idx" ON "agent_runs" ("tenant_id","outcome","started_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluations_tenant_verified_idx" ON "evaluations" ("tenant_id","verified_resolution");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluations_primary_failure_idx" ON "evaluations" ("tenant_id",((failure_codes)[1]));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluation_results_check_verdict_idx" ON "evaluation_results" ("check_id","verdict");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_tenant_status_expires_idx" ON "approvals" ("tenant_id","status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_tenant_decided_idx" ON "approvals" ("tenant_id","decided_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "escalations_run_status_idx" ON "escalations" ("run_id","status");
