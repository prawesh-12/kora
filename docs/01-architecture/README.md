# Architecture

Kora answers a customer, takes a business action, and then proves the action
actually happened. The proving is the point. Everything below exists to make a
claim to a customer checkable against the business system afterwards.

## The shape of the system

```mermaid
flowchart TB
    Customer[Customer in the browser]
    Operator[Operator in the browser]
    Web["apps/web<br/>chat, operator screens, API, health checks"]
    AI["@kora/ai<br/>intent, retrieval, orchestrator, judge"]
    Tools["@kora/tools<br/>registry, pipeline, breaker, caps"]
    Core["@kora/core<br/>types, ids, policy engine, retry"]
    DB["@kora/db<br/>schema, repositories, trace, metrics"]
    Eval["@kora/evaluation<br/>checks, benchmark, replay, alerts"]
    Worker["services/worker<br/>BullMQ: evaluation, ingestion, maintenance"]
    Acme["services/mock-commerce<br/>Acme Store, real HTTP"]
    PG[(Postgres 17 + pgvector)]
    Redis[(Redis)]

    Customer --> Web
    Operator --> Web
    Web --> AI
    AI --> Tools
    Tools --> Acme
    Tools --> Core
    Tools --> Redis
    AI --> DB
    Tools --> DB
    Web -- "run.finished" --> Redis
    Redis --> Worker
    Worker --> Eval
    Eval --> DB
    Eval --> Acme
    DB --> PG
    Acme --> PG
```

The request path never evaluates. A finished run writes a `run.finished` row to
`events` and then enqueues it; the worker picks it up. The row is written first
on purpose, so a lost job can be replayed from the table and a lost row cannot be
replayed from anywhere. If Redis is unreachable the chat route falls back to
evaluating in an `after()` hook, which is what keeps a single-process deployment
working with no worker at all.


## Package boundaries

```
core  <-  db  <-  tools  <-  ai
                     ^
                     |
              evaluation
```

- `core` imports nothing from the workspace. Types, ids, money, clock, canonical
  JSON, errors, the policy engine, the retry table and secret encryption.
- `db` imports `core`. Schema, tenant-scoped repositories, trace writer, trace
  assembler, metric queries.
- `tools` imports `core` and `db`. The Acme client, the nine tools, idempotency,
  the circuit breaker, limited-mode caps, and the execution pipeline.
- `ai` imports `core`, `db`, `tools`. Model gateway, knowledge, intent, the
  orchestrator, the judge caller.
- `evaluation` imports `core`, `db`, `tools`. It reads traces after the fact:
  checks, the failure taxonomy, the benchmark, replay, chaos and the alert rules.
- `services/worker` imports all of them. It is the only place BullMQ appears, so
  a queue never becomes a hidden dependency of the request path.
- **`ai` must never import `evaluation`.** The evaluator is not a runtime
  dependency. If it becomes one, replaying a past run becomes impossible.

`scripts/check-deps.ts` fails the build on any edge outside that matrix, and names
the `ai -> evaluation` case explicitly because it is the one that quietly breaks
later work.

The policy engine lives in `core` because `compilePolicy` and `evaluatePolicy` are
pure: no I/O, no clock, no `await`. Both `tools` (to gate an action) and
`evaluation` (to check compliance afterwards) need them, and putting them in
`core` avoids a cycle. Loading a YAML file from disk is a separate concern and
lives with the caller.

## One customer turn, end to end

```mermaid
sequenceDiagram
    participant C as Customer
    participant O as Orchestrator
    participant I as Intent classifier
    participant R as Retrieval
    participant P as Pipeline
    participant PE as Policy engine
    participant A as Acme
    participant T as Trace

    C->>O: "My coffee machine from order 9832 arrived broken"
    O->>T: start run, state IDENTIFYING_INTENT
    O->>I: classify last 6 messages
    I-->>O: DAMAGED_ORDER, confidence 0.94
    O->>T: state GATHERING_CONTEXT

    O->>P: get_order(9832)
    P->>PE: policy check (reads always allowed)
    P->>A: GET /orders/9832
    A-->>P: delivered 4 days ago, INR 3,499
    P->>T: tool_executions + policy_checks

    O->>R: search_knowledge("damaged item replacement")
    R->>T: run_steps kind=retrieval, chunk ids + distances

    O->>P: create_replacement(9832)
    P->>PE: facts built from the ORDER RECORD, not the message
    PE-->>P: allow, rule standard_replacement
    P->>P: claim idempotency key
    P->>A: POST /replacements
    A-->>P: REP-0041
    P->>A: GET /replacements/REP-0041 (verify)
    A-->>P: exists, one for this order
    P->>T: tool_executions verified=true

    O->>O: grounding check on the draft reply
    O->>C: "Replacement REP-0041 is on its way"
    O->>T: state RESOLVED, finish run
```

## The five things that make this different from a chatbot

**1. Business rules live in code, not in a prompt.** `packages/core/src/policy/`
compiles a YAML file into a predicate tree and evaluates it as a pure function.
The model can be argued with. The engine cannot.

**2. Policy facts come from records, never from the customer's text.**
`packages/tools/src/facts.ts` derives `daysSinceDelivery` from
`order.deliveredAt`, `amountMinor` from `order.totalAmountMinor`, and so on. If
the message says the item arrived yesterday and the order says twelve days ago,
the order wins, silently. This is the half of prompt-injection defence that
actually works. The prompt wording is the other half, and the weaker one.

**3. Every write goes through one chokepoint.**
`packages/tools/src/pipeline.ts` runs thirteen stages in a fixed order: version,
input, permission, policy, caps, approval, deployment mode, breaker,
idempotency, execute, output, verify, settle. A policy check after execution is
not a policy check. `scripts/check-acme-imports.ts` fails the build if anything
outside `packages/tools/src/` reaches the business API. See
[the pipeline](../06-backend/tool-pipeline.md) and
[the deployment ladder](../06-backend/deployment-ladder.md).

**4. A 200 is not proof.** After a successful write the pipeline reads the entity
back and counts how many exist. If the read-back disagrees, the run records
`verified: false`, escalates with `VERIFICATION_FAILED`, and the customer is told
a person will confirm. It never guesses which way the write went.

**5. The reply is checked against the tool results.**
`packages/ai/src/grounding.ts` pulls every replacement id, order id and money
amount out of the draft and asserts each appears in a tool result from this run.
Anything unsupported replaces the whole message with a safe fallback and
escalates.

## Agent states

```mermaid
stateDiagram-v2
    [*] --> NEW
    NEW --> IDENTIFYING_INTENT
    IDENTIFYING_INTENT --> GATHERING_CONTEXT
    IDENTIFYING_INTENT --> NEEDS_HUMAN
    GATHERING_CONTEXT --> PLANNING
    GATHERING_CONTEXT --> RESPONDING
    GATHERING_CONTEXT --> NEEDS_HUMAN
    PLANNING --> WAITING_FOR_TOOL
    PLANNING --> AWAITING_APPROVAL
    PLANNING --> RESPONDING
    PLANNING --> NEEDS_HUMAN
    AWAITING_APPROVAL --> WAITING_FOR_TOOL
    AWAITING_APPROVAL --> NEEDS_HUMAN
    WAITING_FOR_TOOL --> VERIFYING
    WAITING_FOR_TOOL --> ACTION_FAILED
    ACTION_FAILED --> WAITING_FOR_TOOL
    ACTION_FAILED --> NEEDS_HUMAN
    VERIFYING --> RESPONDING
    VERIFYING --> NEEDS_HUMAN
    RESPONDING --> RESOLVED
    RESPONDING --> NEEDS_HUMAN
    RESOLVED --> IDENTIFYING_INTENT
    NEEDS_HUMAN --> [*]
```

The table is data, in `packages/ai/src/state.ts`. An undeclared transition throws
rather than logging and carrying on: reaching an impossible state is a bug in the
orchestrator, and a run that hits one should fail loudly.

## Where a run is recorded

Every turn writes as it goes, not at the end. If the customer closes the tab, the
run still completes and the trace is still whole. `assembleTrace(tenantId, runId)`
rebuilds the entire run from nine small indexed queries, with no log files
involved. See [the database docs](../03-database/README.md).

## Beyond a single workflow

Five capabilities sit on top of the loop above, each with its own page.

**A deployment ladder.** `simulation → shadow → human_approval → limited → full`,
one setting per tenant and overridable per run. The mode gate sits inside the
pipeline after the approval branch, so a write that policy sends to a person
still stops for one even in simulation. See
[the ladder](../06-backend/deployment-ladder.md).

**Replay.** Historical conversations re-run against a different agent version,
served from the state as it was that day rather than as it is now. Self-replay
must produce an empty diff, and the command exits non-zero if it does not. See
[replay](../09-testing/replay.md).

**Versioning that survives a promotion.** Agent and policy versions are rows with
partial unique indexes and PL/pgSQL triggers that reject a write to an active
version. A run pins its version at start, so an in-flight conversation finishes
on the version it began with.

**Isolation in the database, not just in the query.** The application connects as
a non-superuser with a row-level security policy on every tenant-owned table. Nine
tests query with no `WHERE tenant_id` at all and still see only their tenant.
Application scoping is one forgotten clause from a leak; this is the layer that
makes that clause not the last line of defence.

**Reliability and alerting.** Per `(tenant, tool)` circuit breakers, a single
retry table keyed by retry class, a model fallback that never applies to the
judge, and eight alert rules that each carry a drill path to a route that exists.
See [reliability](../06-backend/reliability.md) and
[alerting](../06-backend/alerting.md).
