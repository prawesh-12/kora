#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_docker

compose down -v
bash "$ROOT/infra/scripts/up.sh"

cd "$ROOT"
if [ -f packages/db/src/migrate.ts ]; then
  pnpm --filter @kora/db exec tsx src/migrate.ts
  pnpm --filter @kora/db exec tsx src/seed.ts
fi
if [ -f services/mock-commerce/src/migrate.ts ]; then
  pnpm --filter @kora/mock-commerce exec tsx src/migrate.ts
  pnpm --filter @kora/mock-commerce exec tsx src/seed.ts
fi
if [ -d config/knowledge ] && [ -f scripts/kora.ts ]; then
  pnpm exec tsx scripts/kora.ts ingest config/knowledge || true
fi
echo "infra: reset complete"
