# Testing

Four levels, narrowest first. Run the narrowest one that could catch the thing
you changed.

| Level | Where | Needs |
|---|---|---|
| Unit | `packages/core` | nothing |
| Integration | `packages/db`, `packages/tools`, `packages/ai`, `packages/evaluation` | Postgres and Redis in Docker |
| Service | `apps/web`, `services/worker` | Postgres and Redis in Docker |
| Acceptance | `pnpm kora scenarios` | the above, a tenant Stripe key, the knowledge base ingested |

```bash
pnpm --filter @kora/core test          # pure, fast, no infrastructure
pnpm --filter @kora/tools test         # needs postgres
pnpm test                              # everything, through turbo
pnpm kora scenarios                    # the acceptance gate
pnpm kora scenarios --repeat 3         # flake check
```

## Infrastructure is real; Stripe is not

Every test that touches the database runs against the Postgres container, over a
real socket. Nothing in the tools, evaluation or web suites mocks it. That is
deliberate: the timeouts, retries, verification and idempotency only mean
anything against a real connection. An in-process fake cannot race twenty
parallel writes.

Stripe is the exception, and it is a real limitation rather than a design choice.
Every suite drives an in-memory implementation of the `BillingProvider`
interface. That exercises the pipeline, the policy engine, the idempotency claim,
the verify read-back and the error mapping — but it cannot tell you that a Stripe
field moved or a payload is shaped differently than the code expects. Nothing in
this repository has ever run against a Stripe account. See
[Status](../00-overview/status.md#what-is-not-proven).

Each suite scopes itself to its own tenant id (`ten_pipeline_test`,
`ten_agent_test`, and so on) and cleans up in `afterAll`. `fileParallelism` is
off in every package that shares the database.

`pnpm test` runs the packages one at a time (`turbo test --concurrency=1`). The
billing provider override is process-wide module state, and several suites and
the scenario runner install their own, so two packages running at once would
swap the provider out from under each other.

The operator suites in `apps/web/test` follow the same rule with one exception:
anything that goes through a route handler has to use the real tenant, because the
handler reads `serverEnv().KORA_TENANT_ID` and there is no way to pass a different
one in. Those fixtures track the conversation ids they create and delete exactly
those in `afterAll` (`dropConversations`), rather than emptying a live tenant.

## What each suite is for

**`packages/core`** — the policy engine, canonical JSON, money, ids, env. All
pure. The policy suite is table-driven and covers every rule, both approval
boundaries, both window boundaries, and six missing-fact cases, because treating
an absent `amountMinor` as zero is how a high-value action slips through.

**`packages/db`** — the schema is what it claims to be (`vector(1536)`, an HNSW
index using `vector_cosine_ops`, a unique constraint on `evaluations.run_id`),
tenant scoping actually isolates, and the trace writer survives fifty concurrent
steps, a throwing step, and a run that never called `finish`.

**`packages/tools`** — one case per pipeline stage and per error code, each
asserting both the returned status and the database rows written. Plus the
idempotency race, the Stripe error mapping (one case per SDK error class), the
three verify implementations against both a real read-back and an injected
mismatch, the no-key write gate, the fixture manifest, and the webhook signature
and reconcile paths.

**`packages/ai`** — chunking, retrieval (including a plan assertion that the
correct ordering can use the HNSW index and that `1 - cosineDistance` cannot),
the state machine, intent classification across all six intents, tool gating, and
grounding over refund ids, subscription ids, invoice ids, plan names and money
amounts.

**`packages/evaluation`** — trace fixtures each built to fail exactly one check,
the replay report, the chaos invariants, the benchmark suite's composition, and
the scenario files validated against their schema and against the fixture keys
they are allowed to name.

**`apps/web`** — the API routes against the real database and agent: a full turn
persists, an operator route without a session is 401, an unknown conversation is
404, a double decision is 409, the thirty-first message in a minute is 429, and
the Stripe webhook confirms, dedupes and rejects.

## The acceptance suite

22 scenarios in `scenarios/*.json`, run by `pnpm kora scenarios`. S1 to S12 are
the money workflows; S13 to S22 are prompt-injection attempts, none of which may
produce a write.

| id | What it proves |
|---|---|
| S1 | an in-window refund is allowed, executed and verified |
| S2 | a charge outside the 30-day window is denied, with no write |
| S3 | a request above what is still refundable is denied, and the reply states what is left |
| S4 | a refund at or above the threshold waits for a person |
| S5 | a cancellation lands at period end, with the stop date stated |
| S6 | cancelling an unpaid subscription waits for a person |
| S7 | a plan change lands on the target price, prorated |
| S8 | a large mid-cycle credit waits for a person |
| S9 | a billing question reads only |
| S10 | an ambiguous message hands over instead of guessing |
| S11 | a refund Stripe leaves `pending` is never reported as success |
| S12 | a 500 on the write escalates rather than claiming anything |

Each scenario installs a fresh in-memory billing stub, runs a real turn through
the real pipeline, evaluates the run, and asserts every field in its `expect`
block: the final state, the intent, which tools ran, which tools were forbidden,
the policy decision, the deciding rule id, and the evaluation checks.

The runner refuses to start if the knowledge base is empty, because a reads-only
scenario would otherwise pass for the wrong reason.

Scenarios run sequentially. The billing provider override is process-wide, so two
scenarios at once would share one stub.

Idempotency claims are cleared once per pass, never per scenario. Deleting a
claim another scenario is holding is how a suite manufactures the duplicate write
it exists to detect.

## Offline by default

`KORA_MODEL_PROVIDER=mock` is the default, so the whole suite runs with no API
key and no network. The mock is a real `LanguageModelV3` implementation whose
behaviour is decided by planner functions reading the prompt the SDK built. It
follows the refund and cancellation workflows one tool at a time, reacting to
what each tool actually returned, and it never invents an id or an amount.

That makes the suite deterministic and free. It also means the suite proves the
*system* is correct, not that a particular model is good at the task. Those are
different questions, and the second one needs a real provider and the judge.


## The operator suites

`apps/web/test`, twelve files, all against the real database.

**`api.test.ts`** — the chat routes: a turn is persisted, evaluation is scheduled with
`after()`, the rate limiter holds at 30 a minute, and an approval can be approved or
denied exactly once.

**`metrics.test.ts`** — 25 seeded runs with known outcomes, and every metric asserted
against a number worked out by hand from that table. It is the file that fails if a
metric quietly changes definition: the cost-per-resolution case explicitly asserts
that the denominator is verified resolutions and *not* conversations, and the
coverage runs are given a cost of 999 so that including them would be obvious.

**`conversations.test.ts`** — paging visits every row exactly once, including while
new rows are inserted between pages; ten filter combinations return the right counts;
a cursor round-trips and a forged one is rejected.

**`approvals.test.ts`** — an overdue approval reads as expired even though the stored
row is still `pending` when the test looks at it directly; expiry escalates and
messages the customer; two simultaneous decisions produce one 200 and one 409 naming
the operator; a decision on an expired approval is a 410; the queue sorts by money at
risk and filters by tool and band; a dead webhook endpoint returns `false` instead of
throwing.

**`perf.test.ts`** — 5,000 seeded runs in `ten_perf_test`. Every metrics query, all
55 filter combinations and every page of the full walk finish under 500ms, and the
plans are asserted with `EXPLAIN`.

The plan asks for 25,000 to 50,000 rows. 5,000 is what this machine has room for, and
the plans asserted do not change shape with row count.

### Asserting a plan at 5,000 rows

At this size a sequential scan is often genuinely the cheapest option, so an
`EXPLAIN` of the plain query proves nothing. The assertions run inside a transaction
with `SET LOCAL enable_seqscan = off`, which asks the planner the question that
matters: is there an index that *can* serve this shape at all.

The date ranges in those assertions cover a slice of the window rather than all of
it. A range that excludes nothing is not a range, and the planner correctly prefers
the narrower `agent_runs_tenant_idx` when the `started_at` predicate does no work.

`EXPLAIN` runs over the SQL builders the application itself uses
(`runAggregateSql`, `conversationPageSql`, `failureBreakdownSql`), not over a copy,
so the plan cannot drift from the query.

## The benchmark

`pnpm kora bench` runs the same 22 scenario files and scores them. It keeps the
honest resolution metric: a correct denial and a correct handover both pass, and
neither counts as a resolution, because the customer's problem was not fixed.
Counting them would inflate the headline and hide the cases that matter.

A whole-suite run writes `benchmarks/history.json`, which the next run compares
against. That file is currently empty on purpose: a baseline from a different
version of the system reports a regression that never happened.

## Chaos testing, and why it must run alone

```bash
pnpm kora chaos --fault-rate=0.2 --repeat=3
```

Three passes of the full suite with a fifth of calls to the billing provider
failing. Faults are injected by wrapping the provider
(`FaultInjectingBillingProvider`), so they arrive exactly where a transport
failure would: `timeout`, `500`, `slow`, mapped to `UPSTREAM_TIMEOUT` and
`UPSTREAM_5XX`. The fault rate is a process-wide switch, because the scenario
runner builds a fresh provider per scenario and has to know whether this pass is
meant to be faulty.

Only transport faults are injected at random. A fault that changed stored state
would make every read non-deterministic, and the suite would stop measuring the
agent.

Four things must hold no matter how much is failing:

| Column | What it counts |
|---|---|
| dupes | two successful money writes with identical input on one conversation |
| after deny | a tool that executed although a non-advisory policy check denied it |
| stuck | a run left in a non-terminal state |
| false claims | a conversation whose agent messages exist alongside a money write, where no write in that conversation ever landed `ok` and verified (or deduplicated onto one that had) |

False claims are counted per **conversation**, not per run. A double submit puts
two runs on one conversation: one claims the key and writes, the other times out
waiting. Judged per run, the second looks like a false claim. The customer sees
one conversation, and in it the refund is real.

Resolution rate is allowed to drop, and it should. An agent still resolving 95%
of conversations while a fifth of its calls fail is not being honest.

A pass that throws part way is recorded as not complete and reported as a
failure. A chaos run that crashed half way has proved nothing.

## Run one thing at a time

There is one Postgres, one Redis, and one process-wide billing provider override.
Running two suites at once produces failures that look like flaky tests and are
not.

| Combination | What you see |
|---|---|
| A suite while chaos runs | Unrelated tests fail on injected faults |
| A suite while the benchmark runs | Failures from load, and from the provider being swapped mid-run |
| The worker suite beside anything | It starts a real worker on the shared queues and asserts on what it finds, so any other source of events breaks it |

If a test looks flaky, check this table before looking anywhere else.
