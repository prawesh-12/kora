#!/usr/bin/env bash
# Every rule here is a regression that already shipped once.
#
# components/reui and components/agents are excluded because they are vendored
# upstream files: a rule about our own markup can never pass while it reads theirs.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

SCAN=(grep -rn --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=reui --exclude-dir=agents)
fail() { echo "UI GATE FAILED: $1"; exit 1; }

"${SCAN[@]}" 'type="date"' apps/web/ && fail 'native date input, use @reui/filters'
"${SCAN[@]}" '<select'     apps/web/ && fail 'native select, use @reui/filters'
"${SCAN[@]}" 'font-serif'  apps/web/ && fail 'serif font'
"${SCAN[@]}" '>0ms<'       apps/web/ && fail 'hardcoded 0ms'
grep -rln --exclude-dir=node_modules '<table' apps/web/app/ops/conversations && fail 'hand-written table, use the data grid'
# Source only: package.json has to name the dependency the adapter imports.
"${SCAN[@]}" --include='*.ts' --include='*.tsx' '@tanstack/charts' apps/web/ \
  | grep -v 'components/charts/' && fail 'chart import outside the adapter'
grep -c '@reui' apps/web/components.json | grep -q '[1-9]' || fail 'reui registry not configured'

echo "UI gate passed"
