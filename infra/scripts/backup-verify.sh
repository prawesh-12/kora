#!/usr/bin/env bash
#
# Takes a backup and proves it restores. An untested backup is not a backup.
#
# Dumps the database, restores the dump into a scratch database on the same
# server, compares row counts on the tables an incident would actually need, then
# drops the scratch database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

TABLES=(agent_runs evaluations policy_versions)

if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/.env" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | tail -1 | cut -d= -f2-)"
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "backup-verify: DATABASE_URL is not set" >&2
  exit 1
fi
export DATABASE_URL

for binary in pg_dump pg_restore psql; do
  if ! command -v "$binary" >/dev/null 2>&1; then
    echo "backup-verify: $binary is required" >&2
    exit 1
  fi
done

SCRATCH_DB="kora_restore_check_$$"

urls="$(python3 - "$DATABASE_URL" "$SCRATCH_DB" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit

source, scratch_db = sys.argv[1], sys.argv[2]
parts = urlsplit(source)
print(urlunsplit(parts._replace(path='/postgres')))
print(urlunsplit(parts._replace(path='/' + scratch_db)))
print(parts.path.lstrip('/'))
PY
)"
MAINTENANCE_URL="$(printf '%s\n' "$urls" | sed -n 1p)"
SCRATCH_URL="$(printf '%s\n' "$urls" | sed -n 2p)"
SOURCE_DB="$(printf '%s\n' "$urls" | sed -n 3p)"

WORKDIR="$(mktemp -d)"
DUMP="$WORKDIR/$SOURCE_DB.dump"

cleanup() {
  psql "$MAINTENANCE_URL" -qtAX -c "drop database if exists \"$SCRATCH_DB\" with (force)" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

row_counts() {
  local url="$1" table
  for table in "${TABLES[@]}"; do
    printf '%s %s\n' "$table" "$(psql "$url" -qtAX -c "select count(*) from \"$table\"")"
  done
}

echo "backup-verify: dumping $SOURCE_DB"
pg_dump --format=custom --no-owner --no-privileges --file="$DUMP" "$DATABASE_URL"

if [ ! -s "$DUMP" ]; then
  echo "backup-verify: the dump is empty" >&2
  exit 1
fi
echo "backup-verify: dump is $(du -h "$DUMP" | cut -f1)"

echo "backup-verify: restoring into $SCRATCH_DB"
PGOPTIONS="-c client_min_messages=warning" \
  psql "$MAINTENANCE_URL" -qtAX -c "drop database if exists \"$SCRATCH_DB\" with (force)" >/dev/null
psql "$MAINTENANCE_URL" -qtAX -c "create database \"$SCRATCH_DB\"" >/dev/null

# pg_restore reports non-fatal problems on stderr and still exits non-zero, so the
# log is kept and shown rather than swallowed.
if ! pg_restore --no-owner --no-privileges --exit-on-error --dbname="$SCRATCH_URL" "$DUMP" \
  >"$WORKDIR/restore.log" 2>&1; then
  echo "backup-verify: restore failed" >&2
  cat "$WORKDIR/restore.log" >&2
  exit 1
fi

source_counts="$(row_counts "$DATABASE_URL")"
restored_counts="$(row_counts "$SCRATCH_URL")"

printf '%-20s %12s %12s\n' table source restored
failed=0
while read -r table expected; do
  actual="$(printf '%s\n' "$restored_counts" | awk -v t="$table" '$1 == t { print $2 }')"
  printf '%-20s %12s %12s' "$table" "$expected" "$actual"
  if [ "$expected" = "$actual" ]; then
    printf '  ok\n'
  else
    printf '  MISMATCH\n'
    failed=1
  fi
done <<< "$source_counts"

if [ "$failed" != "0" ]; then
  echo "backup-verify: row counts do not match, the backup is not usable" >&2
  exit 1
fi

echo "backup-verify: restore verified at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
