# Testing

Four levels, narrowest first. Run the narrowest one that could catch the thing
you changed.

| Level | Where | Needs |
|---|---|---|
| Unit | `packages/core` | nothing |
| Integration | `packages/db`, `packages/tools`, `packages/ai` | Postgres in Docker |
| Service | `services/mock-commerce`, `packages/tools`, `packages/ai` | Postgres and Acme on :4001 |
| Acceptance | `pnpm kora scenarios` | Postgres, Acme, the knowledge base ingested |

```bash
pnpm --filter @kora/core test          # pure, fast, no infrastructure
pnpm --filter @kora/tools test         # needs postgres and acme
pnpm test                              # everything, through turbo
pnpm kora scenarios                    # the acceptance gate
pnpm kora scenarios --repeat 3         # flake check
```

## Infrastructure is real, not mocked

Every test that touches the database runs against the Postgres container, and
every test that touches the business system runs against the Acme service over a
real socket. Nothing in the tools or evaluation suites mocks either one.

That is deliberate. The timeouts, retries, verification and idempotency only mean
anything against a real connection. An in-process fake would pass a suite that
proves nothing: it cannot hold a socket open for thirty seconds, and it cannot
race twenty parallel writes.

Each suite scopes itself to its own tenant id (`ten_pipeline_test`,
`ten_agent_test`, and so on) and cleans up in `afterAll`. `fileParallelism` is
off in every package that shares the database.

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

**`packages/tools`** — one case per pipeline stage and per error code, fourteen
in total, each asserting both the returned status and the database rows written.
Plus the twenty-way idempotency race and the verification cases driven by Acme's
fault injection.

**`packages/ai`** — chunking, retrieval (including a plan assertion that the
correct ordering can use the HNSW index and that `1 - cosineDistance` cannot),
the state machine, grounding, and the agent driven end to end against the live
Acme service for the H1, H2 and negative scenarios.

**`packages/evaluation`** — seven trace fixtures, each built to fail exactly one
check, plus the scenario files validated against their schema.

**`services/mock-commerce`** — one case per fault, and the twenty-parallel-POST
test that proves server-side idempotency collapses to one write.

**`apps/web`** — the API routes against the real database and agent: a full turn
persists, an operator route without a session is 401, an unknown conversation is
404, a double decision is 409, and the thirty-first message in a minute is 429.

## The acceptance suite

Twelve scenarios in `scenarios/*.json`, run by `pnpm kora scenarios`. Each one
resets the Acme entities it touches, runs a real turn, snapshots the business
state, evaluates the run, and asserts every field in its `expect` block. H1
additionally asserts the twelve numbered acceptance points separately, so a
failure names which one broke.

The runner refuses to start if Acme is not reachable or the knowledge base is
empty. Both would otherwise produce confusing failures, and an empty knowledge
base would make N10 pass for the wrong reason.

Scenarios run sequentially. They share one Acme dataset, and a scoped reset for
one order still races a run reading the same order.

## Offline by default

`KORA_MODEL_PROVIDER=mock` is the default, so the whole suite runs with no API
key and no network. The mock is a real `LanguageModelV3` implementation whose
behaviour is decided by planner functions reading the prompt the SDK built. It
follows the damaged-order workflow one tool at a time, reacting to what each tool
actually returned, and it never invents an id or an amount.

That makes the suite deterministic and free. It also means the suite proves the
*system* is correct, not that a particular model is good at the task. Those are
different questions, and the second one needs a real provider and the judge.


## The operator suites

`apps/web/test`, five files, all against the real database.

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

## Why the benchmark resets the way it does

120 scenarios run five at a time against one Acme dataset, so who resets what is
load-bearing.

- **A full reset happens once**, at the start of a pass, and nowhere else.
- **A scenario resets only the orders it seeds.** A scoped reset for one order
  still races a scenario reading that order, so scenarios sharing an order are
  serialised by a per-order lock.
- **A scenario with no seeded order resets nothing.** An empty order list must not
  mean "reset everything". Such a scenario holds no order's chain, so the
  per-order lock cannot protect anything from it, and it would wipe the fixture
  out from under whatever is running alongside.
- **Idempotency keys are cleared once per pass, never per scenario.** Deleting a
  claim another scenario is holding is how a benchmark manufactures the duplicate
  write it exists to detect. No scenario needs it: each opens a new conversation
  and the key is scoped to the conversation.

The rule underneath all four: anything that resets shared state must happen while
nothing else is running, or be scoped to something a lock protects.

## Chaos testing, and why it must run alone

```bash
pnpm kora chaos --fault-rate=0.2 --repeat=3
```

Three passes of the full benchmark with a fifth of Acme calls failing. It sets
the fault rate on the mock service over `POST /admin/fault-rate` and clears it
afterwards, because `serverEnv()` is parsed once per process and an environment
variable cannot be changed from outside.

Four things must hold no matter how much is failing:

| Column | What it counts |
|---|---|
| dupes | two replacements or two cancellations on one order |
| after deny | a tool that executed although a gating policy check said no |
| stuck | a run left in a non-terminal state |
| false claims | a conversation naming REP-0041 when no write in it ever landed verified |

Resolution rate is allowed to drop, and it should. An agent still resolving 95%
of conversations while a fifth of its calls fail is not being honest.

A pass that throws part way is recorded as not complete and reported as a
failure. A chaos run that crashed half way has proved nothing.

## Run one thing at a time

There is one Acme service, one Postgres and one Redis, and several suites that
run real agent turns against all three. Running two at once produces failures
that look like flaky tests and are not.

| Combination | What you see |
|---|---|
| A suite while chaos runs | Unrelated tests fail on injected faults |
| A suite while the benchmark runs | Failures from load and from reset timing |
| The worker suite beside anything | It starts a real worker on the shared queues and asserts on what it finds, so any other source of events breaks it |
| `mock-commerce dev` during a suite | `tsx watch` restarts the service on every edit under `packages/`, mid-run |

Use `pnpm --filter @kora/mock-commerce start`, not `dev`, whenever a suite is
running. If a test looks flaky, check this table before looking anywhere else.
