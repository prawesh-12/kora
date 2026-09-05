# Phase 0 inventory — Kora money-ops pivot baseline

Date: 2026-09-05. Machine: 12 CPUs, ~15 GiB RAM, 7.8 GiB available at check time.
No source files were changed for this phase. `docker ps` showed no running
containers, and no Docker infra was started.

## Baseline results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck (all packages, sequential) | `pnpm typecheck --concurrency=1` | 13 tasks successful, 13 total |
| Unit tests, narrow slice | `pnpm --filter @kora/core test` | 8 files passed, 103 tests passed |
| Acme import guard | `pnpm exec tsx scripts/check-acme-imports.ts` | ok |
| Dependency guard | `pnpm exec tsx scripts/check-deps.ts` | ok |

A full `turbo build` (Next.js production build) was skipped as heavy; the
turbo typecheck task depends on `^build` for source packages and covers the
same code. The full test suite was not run: most suites need Postgres/Redis
via Docker, which was not up, and the phase rules require narrow scope and low
concurrency. Infra-dependent suites remain unverified until Phase 1+ brings
Docker up via the repo compose file.

## File inventory (verified paths)

| Item | Real path |
| --- | --- |
| Acme / mock-commerce HTTP client | `packages/tools/src/clients/acme.ts` |
| Mock commerce service entry | `services/mock-commerce/src/index.ts` |
| Mock commerce routes | `services/mock-commerce/src/routes/orders.ts`, `customers.ts`, `refunds.ts`, `cancellations.ts`, `replacements.ts`, `tickets.ts` |
| Mock commerce seed | `services/mock-commerce/src/seed.ts` |
| Mock commerce idempotency + faults | `services/mock-commerce/src/idempotency.ts`, `services/mock-commerce/src/faults.ts` |
| Write pipeline (stage order lives here) | `packages/tools/src/pipeline.ts` (`executeTool`) |
| Pipeline stage modules (imported by pipeline) | `packages/tools/src/caps.ts`, `packages/tools/src/breaker.ts`, `packages/tools/src/facts.ts`, `packages/tools/src/idempotency.ts`, `packages/tools/src/types.ts`, `packages/tools/src/verify.ts` |
| Tool registry | `packages/tools/src/registry.ts` (`defineTool`, `ToolRegistry`) |
| Registered tools | `packages/tools/src/tools/index.ts` plus `get-order.ts`, `get-customer.ts`, `create-refund.ts`, `cancel-order.ts`, `create-replacement.ts`, `create-ticket.ts`, `check-policy.ts`, `escalate-to-human.ts`, `search-knowledge.ts` |
| Tool barrel | `packages/tools/src/index.ts` |
| Policy compile entry points | `packages/core/src/policy/compile.ts` (`compilePolicy`, `compilePolicyBundle`, `bundleVersionOf`, `policyVersionOf`) |
| Policy evaluate entry point | `packages/core/src/policy/evaluate.ts` (`evaluatePolicy`) |
| Policy barrel | `packages/core/src/policy/index.ts` |
| Policy schema | `packages/core/src/policy/schema.ts` (`policyFileSchema`) |
| Current policy files | `config/policies/acme-refunds.yaml`, `acme-cancellations.yaml`, `acme-damaged-order.yaml` |
| Intent classifier | `packages/ai/src/intent.ts` (`detectIntent`) |
| Intent prompt | `packages/ai/src/prompts/intent.ts` (imported by intent classifier) |
| Grounding check | `packages/ai/src/grounding.ts` (`checkGrounding`, `UNGROUNDED_FALLBACK`) |
| Idempotency claim | `packages/tools/src/idempotency.ts` (`deriveKey`, `requestHash`, `claim`, `settleSuccess`, `settleFailure`) |
| Secret-encryption helper | `packages/core/src/secrets.ts` (`encryptSecret`, `decryptSecret`, aes-256-gcm `v1` format) |
| Kora seed script | `packages/db/src/seed.ts` (`seed`) |
| RLS policy setup | `packages/db/migrations/0012_enable_rls.sql` (`kora_tenant_isolation` on all tenant tables), `packages/db/migrations/0013_app_role.sql` |
| RLS enforcement at runtime | `packages/db/src/repositories/index.ts` (`withTenant`, `withTenantTx` sets `kora.tenant_id`), `packages/db/src/client.ts` (connection default) |
| RLS isolation test | `packages/db/test/isolation.test.ts` |
| Agent CLI | `scripts/kora.mts` (`pnpm kora <command>`) |
| Import guard script | `scripts/check-acme-imports.ts` |
| Chat page | `apps/web/app/chat/page.tsx`, `apps/web/app/chat/[conversationId]/` |
| Chat API route | `apps/web/app/api/chat/[conversationId]/` |

Current intents in `packages/ai/src/intent.ts`: `ORDER_STATUS`,
`DAMAGED_ORDER`, `CANCEL_ORDER`, `REFUND_REQUEST`, `HUMAN_REQUEST`,
`OUT_OF_SCOPE`. These are the pre-pivot order-support intents; the pivot
replaces them with the six money-ops intents in Phase 4.

## Pipeline stage order (`packages/tools/src/pipeline.ts`, `executeTool`)

1. Resolve version — agent config pins `name@version`, mismatch fails.
2. Validate input against the tool zod schema.
3. Permission check — tool must be in allowed tools and granted permissions.
4. Policy check — `buildFacts` plus `evaluatePolicy`, always recorded including on allow. Deny stops here.
5. Limited-mode spend caps.
6. Approval gate — `require_approval`, over-cap, or `human_approval` mode writes pause for a person.
7. Deployment-mode gate — simulation/shadow/replay served from records; writes never execute in shadow.
8. Circuit breaker gate.
9. Idempotency claim — `deriveKey` then `claim`; replayed/failed/busy handled before any side effect.
10. Execute with bounded retry inside the run deadline.
11. Validate output against the tool zod schema.
12. Verify read-back — `runVerification`; no verify function means no confirmation.
13. Settle idempotency and write the execution row in one transaction.

## Stripe status

`stripe` is NOT installed. There is no `node_modules/stripe`, and no workspace
manifest (`pnpm-workspace.yaml`, `packages/tools/package.json`,
`apps/web/package.json`) references it. Recording the installed major version
and default API version is deferred to P1-T1 after installation.

## Phase 1 stripe install (P1-T1)

- Package: `stripe@22.6.1`, dependency of `@kora/tools` only
  (`packages/tools/package.json`, installed via
  `pnpm install --filter @kora/tools`).
- SDK major version: **22**.
- Default API version pinned in the SDK (`esm/apiVersion.js`): **`2026-08-26.dahlia`**
  (major `dahlia`, `OPENAPI_VERSION` `v2442`).
- Version-sensitive spots confirmed against the installed types before use
  (plan A7):
  - Preview call is `stripe.invoices.createPreview` (POST
    `/v1/invoices/create_preview`); no `retrieveUpcoming` in this SDK.
  - `current_period_start/end` live on the **subscription item**, not the
    subscription. The provider takes the max `current_period_end` across items.
  - Invoice-to-charge linkage runs through `invoice.payments[].payment`
    (`payment_intent` or a direct `charge`); there is no `charge` field on the
    invoice or the charge object in this API version.
  - Immediate cancel is `stripe.subscriptions.cancel` (no `at_period_end`
    param); cancel-at-period-end is `stripe.subscriptions.update` with
    `cancel_at_period_end: true`.
  - Real error classes: `StripeCardError`, `StripeInvalidRequestError`,
    `StripeAPIError`, `StripeAuthenticationError`, `StripePermissionError`,
    `StripeRateLimitError`, `StripeConnectionError`,
    `StripeSignatureVerificationError`, `StripeIdempotencyError` (all under
    `Stripe.errors`). Request timeouts surface as `StripeConnectionError`
    with a `timed out` message (`ETIMEDOUT`); every write takes the claim key
    as `RequestOptions.idempotencyKey`.
- Provider boundary: `packages/tools/src/billing/types.ts` (`BillingProvider`
  plus the A4 records) and `packages/tools/src/billing/stripe-provider.ts`
  (`StripeBillingProvider`, error mapping per A6, record mapping per A4).
  The tenant key arrives through an injected `resolveKey` callback that reads
  the encrypted store at tool time; the provider never reads `process.env`
  and never logs keys.
- Chokepoint: `scripts/check-acme-imports.ts` (`findStripeViolations`) fails
  any `stripe` or `billing/*` provider import outside `packages/tools/src/`.
- Record-shape choices the next phases should know: amounts stay integer
  minor units with uppercased currency; `InvoicePreview.nextChargeMinor` is
  the sum of positive preview lines; `getInvoice` fills `chargeId` only from
  a direct invoice-payment charge and leaves deep resolution to
  `resolveChargeForInvoice`; unknown Stripe statuses throw
  `MALFORMED_OUTPUT` instead of being guessed.

## Chat happy path (P0-T3 trace, not executed)

Traced against the README and the routes above; the loop was not started
because Docker infra was down and this phase forbids duplicate/heavy bring-up.
Exact commands, in order:

```bash
cp .env.example .env
pnpm install
pnpm infra:reset
pnpm --filter @kora/mock-commerce start &
pnpm --filter @kora/worker start &
pnpm --filter web dev &
pnpm kora scenarios
```

Then open `http://localhost:3000/chat` and send:

> My coffee machine from order 9832 arrived broken. I want a replacement.

Operator console: `http://localhost:3000/login` with `operator@acme.test` /
`operator-password` (seeded by `packages/db/src/seed.ts`).

Health checks: `pnpm smoke` hits `/healthz` and `/readyz`
(`apps/web/app/healthz`, `apps/web/app/readyz`); default base
`http://localhost:3000` via `KORA_SMOKE_URL`.

Request path for one chat turn: chat page -> `POST /api/chat/[conversationId]`
-> intent via `detectIntent` -> agent loop (`packages/ai/src/agent.ts`) ->
`executeTool` stages above against `services/mock-commerce` on `:4001` ->
`checkGrounding` on the draft reply -> response plus recorded trace.

## Risks for later phases

- Docker infra is fully down (`docker ps` empty). Phase 1 acceptance needs
  Postgres/Redis up via `pnpm infra:up`; verify `infra/scripts/up.sh` works
  before running any infra test.
- No `stripe` SDK yet, so every A7 version-sensitive spot (preview-invoice
  method, period fields, invoice-to-charge linkage, webhook event names, error
  classes) is unverified. P1-T1 must confirm names against installed types.
- The chokepoint guard today matches on Acme imports
  (`scripts/check-acme-imports.ts`); P1-T4 must extend it to `stripe` and the
  provider before any Stripe code lands.
- `services/mock-commerce` stays live through Phase 2; its removal (P2-T6) must
  also remove its compose wiring, seed hooks, and scenario fixtures or later
  phases will test against the wrong backend.
- Money amounts today flow through the Acme order model, not integer minor
  units with currency attached; the A4 record mapping must be enforced at the
  new provider boundary with tests, or floats leak into refunds.
