#!/usr/bin/env bash
set -uo pipefail
DIR="apps/web/app/(marketing)"
fail() { echo "GATE FAILED: $1"; exit 1; }

grep -rnE 'bg-gradient-to|from-[a-z]+-[0-9]|via-|shadow-(sm|md|lg|xl|2xl)|drop-shadow|backdrop-blur|rounded-(lg|xl|2xl|3xl)|bg-clip-text|animate-(pulse|bounce|ping)' "$DIR" \
  && fail "banned css class present"

grep -rn 'text-center' "$DIR" && fail "centered content, this design is left-aligned"

grep -rniE 'empower|unlock|transform your|supercharge|seamless|effortless|elevate|revolutioniz|cutting-edge|game-chang|leverage|harness|streamline|next-generation|best-in-class|ready to get started' "$DIR" \
  && fail "banned marketing copy"

grep -rn 'box-decoration-break' "$DIR" || fail "highlight headline not implemented"
grep -c '<h1' "$DIR/page.tsx" | grep -q '^1$' || fail "must be exactly one h1"

echo "marketing gate passed"
