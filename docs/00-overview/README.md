# Kora

Kora is an AI agent for customer operations. It answers a customer, takes a
business action on their behalf, and then proves the action actually happened by
reading the business system back.

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
| Understand the business system it talks to | [Integrations](../08-integrations/README.md) |
| Understand the screens | [Frontend](../05-frontend/README.md) |
| Know what is proven and what is not | [Status](./status.md) |
| Know why something is the way it is | [Decisions](../decisions.md) |
| Fix it at 2am | [Runbook](../runbook.md) |
| Deploy it | [Deployment](../10-deployment/README.md) |

## What it does

A customer says an item from a delivered order arrived damaged. Kora looks the
order up, retrieves the current returns policy, checks the business rules,
creates a replacement if the rules allow it, reads the replacement back to
confirm it exists, and tells the customer the real reference number.

If the rules say no, it explains why. If it cannot confirm what happened, it
stops talking and gets a person.

It now does the same for refunds, cancellations and order status, across six
intents and nine tools.

## What is built beyond that

- **Measurement.** 120 benchmark scenarios, nine deterministic checks, a twelve
  code failure taxonomy, and an LLM judge that can add evidence but never
  overrides a check.
- **Versioning.** Agent and policy versions are rows, not files. A run pins its
  version at start, so an in-flight conversation survives a promotion.
- **A deployment ladder.** `simulation → shadow → human_approval → limited →
  full`. See [the ladder](../06-backend/deployment-ladder.md).
- **Replay.** Historical conversations re-run against a new version, against the
  business state as it was that day. See [replay](../09-testing/replay.md).
- **Isolation.** Row-level security enforced by a non-superuser application role,
  so a forgotten `WHERE tenant_id` still returns nothing.
- **Operations.** A BullMQ worker, circuit breakers, retry policy, alerting with
  drill paths, container images and CI.

## What is deliberately not built

No channels other than the embedded web chat. No real commerce integration
beyond the mock service. No billing, no anomaly detection, no canary rollouts,
no alert authoring UI.

Where the current build stops is listed in [Status](./status.md#limitations)
rather than left to be discovered: failed jobs are counted but not drained,
traces are not exported anywhere, and the judge's gold set is machine-labelled.

## Repository layout

```
apps/web/                 Next.js: chat, operator screens, API routes, health checks
packages/core/            no I/O: types, ids, money, clock, errors, policy, retry, secrets
packages/db/              drizzle schema, migrations, repositories, trace, metrics
packages/tools/           Acme client, nine tools, idempotency, breaker, caps, pipeline
packages/ai/              model gateway, knowledge, intent, orchestrator, judge caller
packages/evaluation/      checks, taxonomy, judge, benchmark, replay, chaos, alerts
services/mock-commerce/   Acme Store: real HTTP, own tables, fault injection
services/worker/          BullMQ: evaluation, ingestion, maintenance
config/                   agent.yaml, policies, knowledge documents, rubrics, pricing
scenarios/                the acceptance suite
benchmarks/               120 generated scenarios, judge gold set
infra/docker/             postgres + redis, plus the production compose file
infra/scripts/            migration job, backup verification
```
