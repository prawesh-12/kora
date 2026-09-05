# What is verified, and what is not

Every claim Kora makes about itself names the command that checks it. Read this
page before trusting a number from anywhere else in these docs.

Kora runs money operations on Stripe Billing in test mode: refunds,
cancellations, plan changes, and billing questions. The sections below separate
three things that are easy to blur together — what a command proves right now,
what has been built but never run against a real Stripe account, and what is
simply not built.

## Run everything

```bash
pnpm test        # every package test suite
pnpm typecheck   # every package
pnpm lint        # Biome, plus five structural checks
```

Last measured on Node 26, Postgres 17 with pgvector and Redis 8 in Docker, with
the offline model provider:

```
pnpm test        618 tests, 56 files, 12 of 12 turbo tasks, all passing
pnpm typecheck   12 of 12 successful
pnpm lint        exits 0
```

| Package | Tests | Files |
|---|---|---|
| `@kora/core` | 105 | 9 |
| `@kora/db` | 56 | 5 |
| `@kora/tools` | 135 | 12 |
| `@kora/ai` | 74 | 8 |
| `@kora/evaluation` | 122 | 7 |
| `web` | 102 | 12 |
| `@kora/worker` | 24 | 3 |

Re-run the commands before quoting these. They change every time a test lands.

## What holds, and the command for each

Every row below is checked by `pnpm test` or `pnpm lint`. None of them needs a
Stripe account, a running web server, or an API key: the billing provider is
behind one interface, and the tests drive a stub through that interface.

| Property | How to check |
|---|---|
| A policy violation cannot move money | `packages/core/test/policy-money.test.ts` — deny above the remaining refundable amount, deny outside the 30-day window, require approval for an unpaid cancellation |
| A missing fact falls to require-approval rather than through | `packages/core/test/policy-money.test.ts` — the missing-facts block |
| The tool gate and the evaluator reach the same decision from the same facts | `packages/tools/test/policy-gate.test.ts` |
| No duplicate refund under retry or double submit | `packages/tools/test/billing-idempotency.test.ts` — two identical `create_refund` calls produce exactly one refund, and the claim key is passed through to Stripe as its idempotency key |
| Every successful write is read back and confirmed | `packages/tools/test/billing-verify.test.ts` — refund, cancellation and plan change each pass on a real read-back and fail on an injected mismatch |
| A pending refund is never reported as success | `packages/tools/test/billing-verify.test.ts` — "never claims success on pending or requires_action" |
| Nothing the agent tells a customer is invented | `packages/ai/test/grounding.test.ts` — an invented refund id, subscription id, invoice id, plan name or money amount replaces the whole reply |
| Facts come from records, not from the customer's message | `packages/tools/test/facts.test.ts` |
| A read-only intent never sees a write tool | `packages/ai/test/gating.test.ts` |
| A high-value refund waits for a person | `packages/core/test/policy-money.test.ts` plus `apps/web/test/approvals.test.ts` |
| A wrong or revoked key never looks like a customer failure | `packages/tools/test/billing.test.ts` — each Stripe error class maps to its Kora code, and `CONFIG_ERROR` is not retryable |
| A tenant with no Stripe key fails a write closed and escalates | `packages/tools/test/billing-phase5.test.ts` — the no-key write gate |
| The tenant key is encrypted at rest and never leaks into a log | `packages/tools/test/billing-phase5.test.ts`, `packages/core/test/secrets.test.ts` |
| A webhook reconciles a pending refund, rejects a bad signature, and ignores a duplicate | `packages/tools/test/stripe-webhooks.test.ts`, `apps/web/test/webhooks-stripe.test.ts` |
| Transport faults at the Stripe boundary break no money invariant | `packages/evaluation/test/phase6.test.ts` — "chaos at the billing provider boundary" |
| Every run can be rebuilt from the database alone | `packages/db/test/tracing.test.ts` |
| Self-replay produces an empty diff | `packages/evaluation/test/replay.test.ts` — "is empty for a self-replay against the identical version" |
| One tenant cannot see another's data | `packages/db/test/isolation.test.ts` (real Postgres, the non-superuser role) |
| Only `packages/tools` reaches Stripe | `pnpm lint` → `scripts/check-billing-imports.ts` |
| Every API route is guarded or explicitly listed public | `pnpm lint` → `scripts/isolation-suite.ts` (12 routes, 0 unguarded) |
| The acceptance suite is well-formed and names only tools that exist | `packages/evaluation/test/scenarios.test.ts` |
| The suite covers all four workflows, every policy outcome, and ten injection attacks | `packages/evaluation/test/phase6.test.ts` — "the benchmark suite" |
| The Proof Card is honest in every state | `apps/web/test/proof-card.test.ts` — verified, pending, denied, failed, and a read-only run that gets no card at all |

## The shape of the integration

- `stripe@22.6.1`, on the SDK's default API version `2026-08-26.dahlia`. The
  provider does not pin one.
- One restricted key per tenant, encrypted in `tenant_settings` and set with
  `pnpm kora stripe:set-key`. A `StripeBillingProvider` is built per tenant from
  that key.
- Six intents: `REFUND_REQUEST`, `CANCEL_SUBSCRIPTION`, `CHANGE_PLAN`,
  `BILLING_QUESTION`, `HUMAN_REQUEST`, `OUT_OF_SCOPE`.
- Eleven tools. Six reads, five writes, of which three spend money.
- Three policy files: `config/policies/refunds.yaml`, `cancellations.yaml`,
  `plan-changes.yaml`. First match wins, and the bundle default is
  require-approval.
- `POST /api/webhooks/stripe` reconciles two event families: refunds
  (`refund.created`, `refund.updated`, `refund.failed`) and subscriptions
  (`customer.subscription.updated`, `customer.subscription.deleted`).
- 22 acceptance scenarios in `scenarios/`: S1–S12 are the money workflows,
  S13–S22 are prompt injection.

## Stripe fixtures

`pnpm kora stripe:fixtures` builds the fixture set in a real test-mode account
when `STRIPE_DEV_KEY` is set, and falls back to the in-memory stub when it is
not. `LiveFixtureBackend` refuses any key that does not start with `sk_test_`,
and tags everything it creates with `metadata.koraFixture` so a person can find
and delete it.

It creates one Test Clock, three customers with payment methods, three
subscriptions on known prices, and three paid invoices whose charges are 45, 20
and 0 days old at the frozen time. Stripe cannot backdate, so the ages come from
creating the oldest subscription first and walking the clock forward between
them.

Running it a second time reports `created: false` and touches nothing. Clearing
the stored manifest and running it again rebuilds the same ids, which is the
stronger check: every backend call is exercised and the result is identical.

To rebuild from scratch, delete the Test Clock named `kora-fixtures` first. It
takes its customers, subscriptions and charges with it, and a clock cannot be
rewound once advanced.

## What is not proven

These are real gaps. They are listed here rather than left to be discovered.

**The refund window cannot be exercised against the live fixtures.**
`daysSinceCharge` (`packages/tools/src/facts.ts`) is derived from the Stripe
charge's `created`, and a charge is stamped with real wall-clock time even when
it belongs to a Test Clock. Only the invoice carries the clock's time. So all
three fixture charges look zero days old to the policy engine, and
`refund_outside_window` never fires against them. The rule itself is proven by
unit tests over the facts, and the ageing is proven through `refundWindowStatus`
against the real clock, but the two are not yet joined up end to end. Sourcing
the window from the invoice instead would fix it, and would be identical in
production where the two timestamps are the same moment.

**The tool pipeline has never run against live Stripe data.** The fixtures are
real, but every test drives the provider through a stub or a fake. A stub cannot
tell you whether a Stripe field moved, a parameter name changed, or a webhook
payload is shaped the way the code expects. The webhook signature check and the
event handling are proven against constructed payloads, not against events Stripe
actually sent.

**The acceptance suite and the benchmark have not been run end to end.** What is
proven is that the scenarios load, validate, reference only fixture keys and
tools that exist, and that the suite's composition is asserted by unit tests.
Running `pnpm kora scenarios` or `pnpm kora bench` for real needs a seeded
database, an ingested knowledge base and a tenant Stripe key. Until someone does
that, there is no pass rate and no verified resolution rate to report.
`benchmarks/gold/` and `benchmarks/history.json` are deliberately empty for the
same reason: a stale baseline reports a regression that never happened.

**Shadow mode has no ground truth.** `services/worker/src/jobs/shadow-compare.ts`
records what the agent proposed, but its `humanResolution` returns null. Reading
what a person actually did now means reading Stripe, and only `packages/tools`
may do that. A run with no human record is skipped, never counted as agreement,
so the agreement rate is honest — it is just computed over nothing.

**`targetPlanPriceId` is not validated against a Prices read.** It is taken from
the proposed input (`packages/tools/src/facts.ts`). No policy rule consumes it,
and a bad price id is rejected by Stripe, so it fails safe. It is still a
deviation from deriving every fact from a record.

**The webhook is single-tenant.** It reads one global endpoint secret
(`STRIPE_WEBHOOK_SECRET`) and one global tenant id (`KORA_TENANT_ID`). A second
tenant needs a second endpoint secret and a way to route an event to the right
tenant, and neither exists.

**The accessibility sweep is not finished.** `apps/web/e2e/a11y.spec.ts` runs
axe over the landing page, the customer chat and every operator screen across
`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `best-practice`, plus a check that
the console does not scroll sideways on a phone. Run it with
`pnpm --filter web test:e2e`; it needs a seeded database and starts its own dev
server.

The landing page and the customer chat report zero violations. The operator
screens have not yet completed a clean run, so treat them as unchecked. The sweep
has already earned its place: it found a colour-contrast failure on the landing
page, a skipped heading level in the Proof Card, and a server-to-client function
prop that made `/ops` return 500 in the running app while every unit test passed.

The Proof Card's state derivation is unit tested; the rendered component and its
drawn check mark are not.

## Limitations

**Stripe test mode only.** Live keys, real charges and real payouts are out of
scope. Nothing here covers them.

**One restricted key per tenant, no Connect.** The runtime key is read from the
encrypted store at tool time and needs Customers read, Subscriptions read and
write, Invoices read, Charges read, PaymentIntents read, Refunds read and write,
and Products and Prices read. It must not be able to create customers. Stripe
Connect OAuth onboarding is not built.

**The webhook covers two event families.** Refunds and subscriptions, and only to
reconcile a pending refund or an at-period-end cancellation. There is no general
event bus, on purpose.

**The model is offline by default.** Kora ships a deterministic model provider so
everything runs with no API key. It exercises the whole path — tool loop,
structured output, retries, timeouts, cost accounting — so it proves the system
is correct. It says nothing about how good a real model is at this task. Set
`KORA_MODEL_PROVIDER` to use one.

**Retrieval quality is not measured.** The offline embedding model is a
bag-of-words hash. It ranks the right passage first on this corpus and exercises
the vector query plan. It says nothing about a real embedding model.

**The judge's gold set is machine-labelled.** Its labels come from the same
evidence the judge reads, so the agreement number measures whether the judge
reads a trace consistently, not whether it agrees with a person. The gate is
real; the number it gates on is not yet meaningful. Replace the labels by hand
before trusting it, then grow the set. See
[the testing notes](../09-testing/README.md).

**Failed background jobs are kept but not drained.** A job that exhausts its
retries stays in the queue, is counted, and raises an alert. Nothing replays it
automatically.

**Traces are not exported anywhere.** Logs are structured and carry a trace id on
every line, and the database holds the durable trace. There is no OpenTelemetry
exporter, because one with no collector behind it is configuration rather than
observability.

**One tenant per deployment.** Row-level security is real and enforced by a
database role that cannot bypass it. The tenant itself still comes from an
environment variable rather than from the signed-in user's organisation.

**Performance is asserted at 5,000 rows.** The query plans do not change shape
with row count, and the assertions run with sequential scans disabled so they ask
whether an index *can* serve the query rather than whether the planner happens to
pick it at this size.

**Some checks still need a person.** Whether an operator can read a failure code
and understand it, or find the cause of a failed run from one screen, has been
verified mechanically. Nobody who did not build the system has tried.
