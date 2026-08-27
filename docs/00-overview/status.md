# What is verified, and what is not

Every claim Kora makes about itself is backed by something you can run. This page
lists what holds, how to check it yourself, and where it stops.

Read it before trusting a number from anywhere else in these docs.

## The guarantees

These are the properties the system is built to hold. Each one names the command
that proves it.

| Property | How to check |
|---|---|
| A policy violation cannot produce a write | `pnpm kora scenarios` — N2, N3, N9 |
| No duplicate write, under retry or double submit | `pnpm kora scenarios` — N6, and the concurrency test in `packages/tools` |
| Every successful write is read back and confirmed | `pnpm kora scenarios` — N7 |
| Nothing the agent tells a customer is invented | the grounding check, and N1 and N10 |
| Every run can be rebuilt from the database alone | `packages/db/test/tracing.test.ts` |
| A failed run records a cause you can act on | `tool_executions.error_code` |
| An upstream timeout or 500 never produces a wrong claim | N4, N5, N7 |
| A risky action waits for a named person | N8, and the approval tests in `apps/web` |
| No business call happens outside the tool pipeline | `pnpm lint` |
| One tenant cannot see another's data | `packages/db/test/isolation.test.ts` |

## The numbers

Measured on Postgres 17 with pgvector, Redis 8, the mock commerce service, and
the offline model provider.

```
pnpm test             537 tests, all passing
pnpm kora scenarios   12 of 12
pnpm kora bench       120 of 120 | resolution 35.0% | policy compliance 100% | injection writes 0
pnpm kora chaos       3 passes at a 20% failure rate, no correctness loss
pnpm kora replay      self-replay produces an empty diff
```

| Package | Tests |
|---|---|
| `@kora/core` | 103 |
| `@kora/db` | 56 |
| `@kora/tools` | 79 |
| `@kora/ai` | 66 |
| `@kora/evaluation` | 90 |
| `@kora/worker` | 24 |
| `@kora/mock-commerce` | 37 |
| `web` | 82 |

Three consecutive benchmark runs land on the same resolution rate, so the
benchmark is measuring the agent rather than noise.

### Why the resolution rate is 35%

Most benchmark scenarios are cases where the correct outcome is *not* a
resolution: a refund the rules deny, a cancellation after the parcel shipped, an
ambiguous message, a customer asking for a person. Those all pass, and none of
them counts as a resolution, because the customer's problem was not fixed.
Counting them would inflate the headline and hide the cases that matter.

### Under failure

With a fifth of business calls failing, across 360 conversations:

| Measure | Result |
|---|---|
| Duplicate side effects | 0 |
| Actions taken after a policy denial | 0 |
| Runs left in a non-terminal state | 0 |
| Customers told about an action that never landed | 0 |
| Resolution rate | falls from 35% to between 5% and 12.5% |

The resolution rate is meant to fall. An agent still resolving 95% of
conversations while a fifth of its calls are failing is not being honest.

## Limitations

Named here rather than left to be discovered.

**The model is offline by default.** Kora ships a deterministic model provider so
everything runs with no API key. It exercises the whole path — tool loop,
structured output, retries, timeouts, cost accounting — so it proves the system
is correct. It says nothing about how good a real model is at this task. Set
`KORA_MODEL_PROVIDER` to use one.

**Retrieval quality is not measured.** The offline embedding model is a
bag-of-words hash. It ranks the right passage first on this corpus and exercises
the vector query plan. It says nothing about a real embedding model.

**The judge's gold set is machine-labelled.** Thirty traces, labelled from the
same evidence the judge reads. The agreement number therefore measures whether
the judge reads a trace consistently, not whether it agrees with a person. The
gate is real; the number it gates on is not yet meaningful. Replace the labels by
hand before trusting it, then grow the set. See
[the testing notes](../09-testing/README.md).

**Failed background jobs are kept but not drained.** A job that exhausts its
retries stays in the queue, is counted, and raises an alert. Nothing replays it
automatically yet.

**Traces are not exported anywhere.** Logs are structured and carry a trace id on
every line, and the database holds the durable trace. There is no OpenTelemetry
exporter, because one with no collector behind it is configuration rather than
observability.

**One tenant per deployment.** Row-level security is real and enforced by a
database role that cannot bypass it. The tenant itself still comes from an
environment variable rather than from the signed-in user's organisation.

**No browser tests.** The screens are verified by driving the HTTP API and
checking what renders, not by driving a browser.

**Performance is asserted at 5,000 rows.** The query plans do not change shape
with row count, and the assertions run with sequential scans disabled so they ask
whether an index *can* serve the query rather than whether the planner happens to
pick it at this size.

**Some checks still need a person.** Whether an operator can read a failure code
and understand it, or find the cause of a failed run from one screen, has been
verified mechanically. Nobody who did not build the system has tried.
