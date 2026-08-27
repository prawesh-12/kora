#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

deadline=$((SECONDS + 60))
while [ $SECONDS -lt $deadline ]; do
  unhealthy="$(compose ps --format json \
    | python3 -c '
import json,sys
bad=[]
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    row=json.loads(line)
    if isinstance(row, list):
        rows=row
    else:
        rows=[row]
    for r in rows:
        if r.get("Health") != "healthy":
            bad.append(r.get("Service") or r.get("Name"))
print(" ".join(bad))')"
  if [ -z "$unhealthy" ]; then
    echo "infra: postgres and redis healthy"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for: $unhealthy" >&2
for svc in $unhealthy; do
  echo "--- last 50 log lines from $svc ---" >&2
  compose logs --tail=50 "$svc" >&2 || true
done
exit 1
