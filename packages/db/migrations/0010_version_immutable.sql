-- Exactly one active version per agent, and one active version per policy.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_versions_one_active"
  ON "agent_versions" ("agent_id") WHERE status = 'active';--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "policy_versions_one_active"
  ON "policy_versions" ("policy_id") WHERE status = 'active';--> statement-breakpoint

-- An active version is immutable. Application-level protection is not enough:
-- someone will eventually run a migration or a manual query. The only change an
-- active row may take is being archived.
CREATE OR REPLACE FUNCTION kora_reject_active_version_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status <> 'archived' THEN
    RAISE EXCEPTION
      'agent_versions row % is active and immutable. Create a new draft instead of editing it.',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'active' AND NEW.status = 'archived' THEN
    -- Archiving must not smuggle in a content change.
    IF ROW(NEW.model, NEW.system_prompt, NEW.intent_prompt, NEW.allowed_tools,
           NEW.permissions, NEW.policy_bundle, NEW.rubric_version, NEW.max_steps,
           NEW.run_deadline_ms, NEW.confidence_threshold)
       IS DISTINCT FROM
       ROW(OLD.model, OLD.system_prompt, OLD.intent_prompt, OLD.allowed_tools,
           OLD.permissions, OLD.policy_bundle, OLD.rubric_version, OLD.max_steps,
           OLD.run_deadline_ms, OLD.confidence_threshold) THEN
      RAISE EXCEPTION
        'agent_versions row % cannot change its content while being archived.', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS kora_agent_versions_immutable ON "agent_versions";--> statement-breakpoint

CREATE TRIGGER kora_agent_versions_immutable
  BEFORE UPDATE ON "agent_versions"
  FOR EACH ROW EXECUTE FUNCTION kora_reject_active_version_update();--> statement-breakpoint

-- A published policy version is never mutated at all. Closing its effective
-- window is the one exception, because that is how a supersession is recorded.
CREATE OR REPLACE FUNCTION kora_reject_policy_version_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_yaml IS DISTINCT FROM OLD.source_yaml
     OR NEW.compiled IS DISTINCT FROM OLD.compiled
     OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION
      'policy_versions row % is published and immutable. Publish a new version instead.',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS kora_policy_versions_immutable ON "policy_versions";--> statement-breakpoint

CREATE TRIGGER kora_policy_versions_immutable
  BEFORE UPDATE ON "policy_versions"
  FOR EACH ROW EXECUTE FUNCTION kora_reject_policy_version_update();
