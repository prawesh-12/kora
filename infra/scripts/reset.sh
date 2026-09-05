#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_docker

compose down -v
bash "$ROOT/infra/scripts/up.sh"

cd "$ROOT"
pnpm kora migrate
pnpm kora seed
pnpm kora ingest config/knowledge
echo "infra: reset complete"
