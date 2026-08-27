CREATE INDEX IF NOT EXISTS "agent_runs_tenant_started_idx" ON "agent_runs" USING btree ("tenant_id","started_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_tenant_config_started_idx" ON "agent_runs" USING btree ("tenant_id","agent_config_version","started_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_tenant_intent_started_idx" ON "agent_runs" USING btree ("tenant_id","intent","started_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_tenant_outcome_started_idx" ON "agent_runs" USING btree ("tenant_id","outcome","started_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_tenant_status_expires_idx" ON "approvals" USING btree ("tenant_id","status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_tenant_decided_idx" ON "approvals" USING btree ("tenant_id","decided_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "escalations_run_status_idx" ON "escalations" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluation_results_check_verdict_idx" ON "evaluation_results" USING btree ("check_id","verdict");