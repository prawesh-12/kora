#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_docker

compose down -v
bash "$ROOT/infra/scripts/up.sh"

cd "$ROOT"
pnpm kora migrate
pnpm kora seed
pnpm --filter @kora/mock-commerce migrate
pnpm --filter @kora/mock-commerce seed
pnpm kora ingest config/knowledge
echo "infra: reset complete"
