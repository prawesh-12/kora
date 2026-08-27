-- Row-level security does nothing for a superuser, and the compose Postgres makes
-- POSTGRES_USER one. Without a separate application role, the policies added in
-- 0012 are decoration.
--
-- Migrations keep running as the owner (DATABASE_URL). The runtime connects as
-- this role (DATABASE_APP_URL), which owns nothing and cannot bypass a policy.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kora_app') THEN
    CREATE ROLE kora_app LOGIN PASSWORD 'kora_app';
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO kora_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kora_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kora_app;--> statement-breakpoint

-- Tables created by a later migration are covered without anyone remembering.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kora_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO kora_app;
