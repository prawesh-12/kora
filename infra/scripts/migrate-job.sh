#!/usr/bin/env bash
#
# Applies database migrations as a job of its own. Nothing migrates on app boot.
#
# The advisory lock is the second line of defence. Two deploys firing at the same
# moment, or someone reintroducing boot-time migration, would otherwise have two
# processes running DDL against the same schema.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Any 64-bit constant works; every caller has to use the same one.
LOCK_KEY=7412553390110001
LOCK_TIMEOUT="${KORA_MIGRATE_LOCK_TIMEOUT:-5min}"

if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/.env" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | tail -1 | cut -d= -f2-)"
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "migrate-job: DATABASE_URL is not set" >&2
  exit 1
fi
export DATABASE_URL

if ! command -v psql >/dev/null 2>&1; then
  echo "migrate-job: psql is required to hold the advisory lock" >&2
  exit 1
fi

echo "migrate-job: waiting for the migration lock (timeout $LOCK_TIMEOUT)" >&2

# The lock lives for as long as the psql session, so the migration has to run from
# inside that session. `\!` does exactly that, and psql reports what the shell
# command exited with.
#
# DDL runs as the database owner. The runtime connects as `kora_app`, which owns
# nothing on purpose, and `.env` is read by the CLI itself, so the override has to
# be in the environment rather than unset.
output="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtAX <<SQL
set lock_timeout = '$LOCK_TIMEOUT';
select pg_advisory_lock($LOCK_KEY);
select 'migrate-job: lock acquired at ' || clock_timestamp() as acquired \gset
\warn :acquired
\! cd "$ROOT" && pnpm kora migrate </dev/null 1>&2
\echo migrate-job-exit::SHELL_EXIT_CODE
select 'migrate-job: lock released at ' || clock_timestamp() as released \gset
\warn :released
select pg_advisory_unlock($LOCK_KEY);
SQL
)"

code="$(printf '%s\n' "$output" | sed -n 's/^migrate-job-exit:\([0-9]*\)$/\1/p' | tail -1)"

if [ -z "$code" ]; then
  echo "migrate-job: could not determine the migration exit status" >&2
  exit 1
fi
if [ "$code" != "0" ]; then
  echo "migrate-job: migrations failed with exit $code" >&2
  exit "$code"
fi

echo "migrate-job: migrations applied" >&2
