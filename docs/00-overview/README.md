# Kora

Kora is a money-operations agent for subscription businesses on Stripe Billing.
It answers a customer, performs a refund, cancellation or plan change on their
behalf, and then proves the action actually happened by reading it back out of
Stripe.

That last part is the whole idea:

> An AI agent should not be trusted because it says it completed a task. It
> should prove the business outcome through verified system state.

## Where to start

| You want to | Read |
|---|---|
| Run it | [QUICKSTART](../QUICKSTART.md) |
| Understand how it fits together | [Architecture](../01-architecture/README.md) |
| Understand the rules it follows | [Domain](../02-domain/README.md) |
| Understand the data | [Database](../03-database/README.md) |
| Understand the HTTP surface | [API](../04-api/README.md) |
| Understand the background work | [Jobs and queues](../07-jobs-and-queues/README.md) |
| Understand the Stripe integration | [Integrations](../08-integrations/README.md) |
| Understand the screens | [Frontend](../05-frontend/README.md) |
| Know what is proven and what is not | [Status](./status.md) |
| Know why something is the way it is | [Decisions](../decisions.md) |
| Fix it at 2am | [Runbook](../runbook.md) |
| Deploy it | [Deployment](../10-deployment/README.md) |

## What it does

A customer asks for their last payment back. Kora looks the subscription up in
Stripe, finds the invoice and the charge behind it, retrieves the current refund
policy, checks the rules, creates the refund if the rules allow it, reads the
refund back to confirm it succeeded, and tells the customer the real reference.

If the rules say no, it explains why. If Stripe returns a refund that is
`pending` rather than `succeeded`, it does not claim success — it says a person
will confirm, and the webhook reconciles it later. If it cannot confirm what
happened, it stops talking and gets a person.

It does the same for cancellations and plan changes, and answers billing
questions read-only, across six intents and eleven tools.

## What is built beyond that

- **Measurement.** Nine deterministic checks, a failure taxonomy, and an LLM
  judge that can add evidence but never overrides a check. 22 acceptance
  scenarios: twelve money workflows and ten prompt-injection attempts.
- **Versioning.** Agent and policy versions are rows, not files. A run pins its
  version at start, so an in-flight conversation survives a promotion.
- **A deployment ladder.** `simulation → shadow → human_approval → limited →
  full`. See [the ladder](../06-backend/deployment-ladder.md).
- **Replay.** Historical conversations re-run against a new version, served from
  the Stripe responses recorded that day. See [replay](../09-testing/replay.md).
- **Isolation.** Row-level security enforced by a non-superuser application role,
  so a forgotten `WHERE tenant_id` still returns nothing.
- **Operations.** A BullMQ worker, circuit breakers, retry policy, alerting with
  drill paths, container images and CI.

## What is deliberately not built

Stripe test mode only. One restricted key per tenant, and no Stripe Connect
onboarding. No provider other than Stripe. No channels other than the embedded
web chat. No dunning or retry optimization, no anomaly detection, no canary
rollouts, no alert authoring UI, and no billing of Kora's own.

Where the current build stops is listed in
[Status](./status.md#what-is-not-proven) rather than left to be discovered. The
short version: the Stripe fixtures are real, but the tool pipeline is only ever
tested through a stub, and the refund window cannot yet be exercised against
those fixtures.

## Repository layout

```
apps/web/                 Next.js: chat, operator screens, API routes, health checks
packages/core/            no I/O: types, ids, money, clock, errors, policy, retry, secrets
packages/db/              drizzle schema, migrations, repositories, trace, metrics
packages/tools/           Stripe provider, eleven tools, idempotency, breaker, caps, pipeline
packages/ai/              model gateway, knowledge, intent, orchestrator, judge caller
packages/evaluation/      checks, taxonomy, judge, benchmark, replay, chaos, alerts
services/worker/          BullMQ: evaluation, ingestion, maintenance
config/                   agent.yaml, the three policy files, knowledge, rubrics, pricing
scenarios/                the acceptance suite, S1-S22
benchmarks/               benchmark history and the judge gold set
infra/docker/             postgres + redis, plus the production compose file
infra/scripts/            migration job, backup verification
```
