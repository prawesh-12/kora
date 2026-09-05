-- Application scoping is one forgotten WHERE clause away from a leak; this is what
-- keeps a single mistake from being a breach.
--
-- `current_setting('kora.tenant_id', true)` returns NULL when unset, and
-- `tenant_id = NULL` is NULL, so an unset connection sees nothing. Fail closed.
--
-- The setting is a connection parameter (see packages/db/src/client.ts) and can be
-- overridden per transaction with set_config(..., true) for a multi-tenant path.

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "tenants";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "tenants"
  USING (id = current_setting('kora.tenant_id', true))
  WITH CHECK (id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "documents";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "documents"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "document_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_chunks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "document_chunks";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "document_chunks"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "conversations";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "conversations"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "messages";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "messages"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "agent_runs";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "agent_runs"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "run_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "run_steps";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "run_steps"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "tool_executions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tool_executions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "tool_executions";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "tool_executions"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "policy_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "policy_checks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "policy_checks";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "policy_checks"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approvals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "approvals";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "approvals"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "escalations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "escalations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "escalations";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "escalations"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "evaluations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evaluations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "evaluations";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "evaluations"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "evaluation_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evaluation_results" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "evaluation_results";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "evaluation_results"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "llm_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_calls" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "llm_calls";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "llm_calls"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "idempotency_keys";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "idempotency_keys"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "events";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "events"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "agents";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "agents"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "agent_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "agent_versions";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "agent_versions"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "policies";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "policies"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "policy_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "policy_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "policy_versions";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "policy_versions"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "shadow_comparisons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shadow_comparisons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "shadow_comparisons";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "shadow_comparisons"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
ALTER TABLE "promotions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "promotions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS kora_tenant_isolation ON "promotions";--> statement-breakpoint
CREATE POLICY kora_tenant_isolation ON "promotions"
  USING (tenant_id = current_setting('kora.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('kora.tenant_id', true));--> statement-breakpoint
-- The four Better Auth tables stay global on purpose: a user and a session are
-- not tenant-owned, and scoping them would break sign-in.
