# Alerting

`packages/evaluation/src/alerts.ts`. Eight rules over a one hour window, run
every minute by the worker and on demand by `pnpm kora alerts:test`.

The runbook has a section per alert with what to check first. This file is about
how the rules are built and why they behave the way they do.

## The rules

| Rule | Severity | Fires when |
|---|---|---|
| `critical_check_unmet` | page | a critical deterministic check is `UNMET` on a `limited` or `full` run |
| `policy_compliance_below_floor` | page | policy compliance under 99% |
| `vrr_dropped` | page | verified resolution fell more than 10 points day over day |
| `unverified_write` | page | a write executed and read back as unverified |
| `missing_rollup` | page | runs finished and none of them was evaluated |
| `dlq_not_empty` | warn | any queue has failed jobs |
| `breaker_open` | warn | a breaker has been open more than five minutes |
| `judge_spend_high` | warn | the judge cost more than a quarter of agent spend |

## Three things that keep them useful

**Every rule carries a drill path.** An alert with no next step gets ignored
within a week. There is a test that resolves each rule's `drillUrl` against the
list of routes that exist and fails if one points nowhere. `unverified_write`
skips the list and links straight to the trace, because that one has a single
obvious next step.

**Rules go quiet on missing data, not loud.** An empty window means the system
was idle or the evaluation worker stopped. Firing every rule on that pages
someone about the monitoring rather than the system. `missing_rollup` is the one
rule that covers the empty case, so a dead worker still pages exactly once
instead of eight times.

**A rule that throws becomes a warning, not an outage.** If a probe cannot run,
the result is a `warn` saying the rule could not be evaluated. A rule that cannot
run is worth showing and is not evidence the thing it watches is broken.

## Probes are injected

Two rules need data that lives outside `packages/evaluation`: queue depth is
BullMQ in the worker, and breaker state is Redis in `packages/tools`. Inverting
that would make `evaluation` depend on the worker it evaluates.

```ts
await evaluateAlerts({
  tenantId,
  probes: {
    failedJobCounts: async () => ({ evaluation: 0, ingestion: 0, maintenance: 0 }),
    openBreakers: () => breaker().listOpen(),
  },
});
```

No probe means those two rules report that they were not checked. They do not
fire. A missing probe is a gap in the monitoring, not a failure of the system.

## Delivery

Firing alerts are logged at `error` for `page` and `warn` for `warn`, with the
rule id, severity and drill path as structured fields. When
`KORA_ALERT_WEBHOOK_URL` is set they are also posted there, and a failed post
throws so the queue retries: an alert that was never delivered must not be
recorded as delivered.

There is no pager integration in this repository. Wiring a fake one would make
the alerting look finished when nothing would reach a person.

## Judge spend

Agent cost is read from `agent_runs.cost_usd_micros`, not from `llm_calls`: the
agent loop is run by the AI SDK and its usage is accounted on the run rather than
call by call. Judge calls are recorded in `llm_calls` with `purpose = 'judge'`, so judge spend
can be told apart from intent classification.
