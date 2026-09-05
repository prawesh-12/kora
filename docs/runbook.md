# Runbook

One section per thing that goes wrong. Each says what it means, what to look at
first, and what to do about it.

Assumed environment variables: `DATABASE_URL`, `REDIS_URL`, `KORA_APP_URL`.
Locally they come from `.env`.

## Start here

```bash
curl -s "$KORA_APP_URL/healthz"     # is the process alive
curl -s "$KORA_APP_URL/readyz"      # which dependency is down
pnpm smoke                          # both of the above, non-zero on failure
```

`/healthz` touches nothing. If it answers, the process is alive and a restart
will not help. `/readyz` names the failing dependency and **caches for 10
seconds**, so wait that long before believing a stale answer.

`/api/status` needs an operator session and reports the running version, the
active agent versions, queue depth and circuit breaker states.

---

## Alerts, and where each one goes

`pnpm kora alerts:test` runs every rule right now and prints what is firing,
what is quiet, and the drill path for each. It exits non-zero if anything at
`page` severity is firing. The worker runs the same rules every minute.

| Alert | Severity | Section |
|---|---|---|
| `critical_check_unmet` | page | [A critical check failed in production](#a-critical-check-failed-in-production) |
| `policy_compliance_below_floor` | page | [Policy compliance is below 100%](#policy-compliance-is-below-100) |
| `vrr_dropped` | page | [Verified resolution fell overnight](#verified-resolution-fell-overnight) |
| `unverified_write` | page | [A write was recorded with `verified: false`](#a-write-was-recorded-with-verified-false) |
| `missing_rollup` | page | [Runs finish but nothing is evaluated](#runs-finish-but-nothing-is-evaluated) |
| `dlq_not_empty` | warn | [The dead letter queue is not empty](#the-dead-letter-queue-is-not-empty) |
| `breaker_open` | warn | [A circuit breaker is stuck open](#a-circuit-breaker-is-stuck-open) |
| `judge_spend_high` | warn | [The judge costs too much](#the-judge-costs-too-much) |

Every alert carries a `drillUrl`. It is a real route, and there is a test that
fails if a rule ever points somewhere that does not exist.

Alerts go quiet on missing data rather than firing on it. `missing_rollup` is
the one that covers the empty window, so a dead evaluation worker still pages.

---

## A critical check failed in production

**What it means.** A finished run failed a check marked critical: the outcome
did not happen, a policy was broken, or the reply claimed something no tool
result supports. This is the system doing the wrong thing, not doing it slowly.

**Look at first.** The drill path is the conversation list filtered to
unverified runs in the last day. Open one and read the trace top to bottom: the
policy decision, the tool executions, then the final message.

```bash
pnpm kora alerts:test              # which check, and how many runs
```

**What to do.** If a single tool or one subscription is responsible, it is
usually Stripe returning a shape the tool schema did not expect, and the run will
show `MALFORMED_OUTPUT` or a verify failure. If it is spread across
intents, suspect the agent version: `pnpm kora agent:versions`, then
`pnpm kora agent:rollback`. Rollback needs no redeploy and in-flight runs
finish on the version they started with.

---

## Verified resolution fell overnight

**What it means.** The share of conversations that ended in a verified
resolution dropped more than ten points day over day.

**Look at first.** `/ops/evaluations?days=7` for which intent moved, then the
failure breakdown underneath it for which code grew.

**What to do.** A drop concentrated in one intent is usually a policy or
knowledge change. A drop across all intents is usually a version or a
dependency. Compare the two versions before changing anything:

```bash
pnpm kora replay --from <old> --against <new> --limit 100
```

Read the regressions above the aggregate. A version with a better headline
number and six regressions is not automatically better.

---

## Runs finish but nothing is evaluated

**What it means.** Runs completed in the window and none of them has an
evaluation row. The evaluation worker is not consuming the queue.

**Look at first.**

```bash
curl -s "$KORA_APP_URL/api/status"   # queue depth, with a session
docker compose -f infra/docker/docker-compose.prod.yml logs worker --tail 100
```

**What to do.** Restart the worker. Nothing is lost: `run.finished` is written
to the `events` table before it is enqueued, and the `replay-pending-events`
job re-enqueues anything that never made it. Evaluation is delayed, never
dropped.

---

## A circuit breaker is stuck open

**What it means.** A breaker for one `(tenant, tool)` pair, or a model
provider, has been open more than five minutes. Calls to it are failing fast
and the agent is escalating instead of acting.

**Look at first.** `/api/status` lists every open breaker and how long it has
been open. The duration comes from a marker that survives re-opens, so it is
how long the dependency has actually been down, not time since the last probe.

**What to do.** Fix the dependency; the breaker closes itself after a good
probe. See [Stripe is unreachable](#stripe-is-unreachable) or
[A model provider is down](#a-model-provider-is-down). Do not clear the breaker
by hand to "unblock" traffic: it is open because writes were failing, and
forcing it closed sends real customer actions at a system that cannot take
them.

---

## The judge costs too much

**What it means.** The LLM judge spent more than a quarter of what the agent
spent over the window. The judge exists to add evidence at the margin, not to
be the bulk of the bill.

**Look at first.**

```sql
select purpose, count(*), sum(cost_usd_micros)
from llm_calls where created_at > now() - interval '1 day' group by 1;
```

**What to do.** Lower `KORA_JUDGE_SAMPLE_RATE`. The deterministic checks are a
complete evaluation on their own and the judge never overrides them, so
sampling less costs coverage of the soft criteria and nothing else. If spend
looks wrong rather than high, check that the judge model is the one you meant:
`KORA_MODEL_JUDGE`.

---

## Postgres is unreachable

**What it means.** Nothing works. Every request that touches a run, a
conversation or an approval fails. `/readyz` returns 503 with
`checks.postgres.ok = false`.

**Check first.**

```bash
curl -s "$KORA_APP_URL/readyz" | python3 -m json.tool
psql "$DATABASE_URL" -c 'select 1'
docker compose -f infra/docker/docker-compose.yml ps postgres
docker compose -f infra/docker/docker-compose.yml logs --tail=100 postgres
```

Then check whether it is refusing connections or refusing *this* connection:

```bash
psql "$DATABASE_URL" -c "select count(*), max(state) from pg_stat_activity"
psql "$DATABASE_URL" -c "show max_connections"
```

**Mitigate.**

- Connections exhausted: the app pool is 10 per process. Reduce the number of web
  and worker instances, or raise `max_connections` and restart Postgres.
- Container down locally: `pnpm infra:up`.
- Managed instance down: there is nothing to do in the app. Take the fleet out of
  rotation by letting `/readyz` fail, and wait. `/healthz` still answers, so the
  processes stay up and reconnect on their own.
- Disk full on the database host is the usual cause of a sudden refusal. Check it
  before restarting anything.

Do **not** restart the web or worker processes to "clear" this. The pool
reconnects by itself and a restart loses in-flight work.

---

## Redis is unreachable

**What it means.** Background jobs stop moving and the circuit breakers cannot be
read. The web app keeps serving: `wireQueues` fails closed and evaluation falls
back to running inline on the request path. Events are still written to the
`events` table with `enqueued = false`, so nothing is lost.

**Check first.**

```bash
curl -s "$KORA_APP_URL/readyz" | python3 -m json.tool
docker compose -f infra/docker/docker-compose.yml exec redis redis-cli ping
docker compose -f infra/docker/docker-compose.yml logs --tail=100 redis
psql "$DATABASE_URL" -tAc "select count(*) from events where enqueued = false"
```

**Mitigate.**

- Bring Redis back (`pnpm infra:up` locally).
- The `replay-pending-events` maintenance job runs every five minutes and
  enqueues everything with `enqueued = false`, so the backlog drains on its own
  once Redis answers. Watch the count above go down.
- If it does not go down, the worker is not running. See the next section.

Writes are safe while Redis is down: with the breaker store unreadable the
pipeline refuses write tools rather than guessing, so the worst case is
escalation, not a duplicate refund.

---

## The worker is not draining

**What it means.** Jobs are queued and nobody is taking them. Evaluations stop
appearing, approvals stop expiring, ingestion stalls. `queueDepth.*.waiting`
climbs in `/api/status`.

**Check first.**

```bash
curl -s -b cookies.txt "$KORA_APP_URL/api/status" | python3 -m json.tool
docker compose -f infra/docker/docker-compose.prod.yml ps worker
docker compose -f infra/docker/docker-compose.prod.yml logs --tail=200 worker
```

A healthy worker logs `worker started` with the three queue names once, at boot.
If that line is missing, it never connected.

Depth without a running worker:

```bash
docker compose -f infra/docker/docker-compose.yml exec redis \
  redis-cli LLEN bull:evaluation:wait
```

**Mitigate.**

- No worker process: start it. `pnpm worker` locally,
  `docker compose -f infra/docker/docker-compose.prod.yml up -d worker` otherwise.
- Worker up but `active` is stuck at the concurrency limit (5 for evaluation):
  jobs are hanging, usually on a model call. Restart the worker. It waits 30
  seconds for in-flight jobs, then closes; BullMQ redelivers whatever was in
  flight, and `evaluations.run_id` is unique so a redelivery cannot double-write.
- Worker restarting in a loop: read the logs. A bad `DATABASE_URL` or
  `REDIS_URL` is the usual cause and shows as a config error at boot.

---

## The dead letter queue is not empty

**What it means.** Jobs failed all five attempts. They are kept, not deleted, on
purpose: `removeOnFail: false`. `queueDepth.*.failed` in `/api/status` is the
number.

**Check first.**

```bash
docker compose -f infra/docker/docker-compose.yml exec redis \
  redis-cli ZCARD bull:evaluation:failed
```

Read the failures, newest first:

```bash
cd services/worker && pnpm exec tsx -e "(async()=>{
  const {Queue}=await import('bullmq');
  const IORedis=(await import('ioredis')).default;
  const q=new Queue('evaluation',{connection:new IORedis('$REDIS_URL')});
  for (const j of await q.getFailed(0,20)) console.log(j.id, j.name, j.failedReason);
  await q.close(); process.exit(0);
})()"
```

**Mitigate.**

1. Read `failedReason` before retrying anything. Retrying a job that fails
   deterministically just burns another five attempts.
2. If the cause was an outage that is now over, retry them:

```bash
cd services/worker && pnpm exec tsx -e "(async()=>{
  const {Queue}=await import('bullmq');
  const IORedis=(await import('ioredis')).default;
  const q=new Queue('evaluation',{connection:new IORedis('$REDIS_URL')});
  const jobs=await q.getFailed(0,500);
  for (const j of jobs) await j.retry();
  console.log('retried', jobs.length);
  await q.close(); process.exit(0);
})()"
```

3. If the cause is a bug, leave them. They are the reproduction case. Fix the
   bug, deploy, then retry.

Swap `evaluation` for `ingestion` or `maintenance` as needed.

---

## A write was recorded with `verified: false`

**What it means.** A tool call returned success and the read-back did not find
the change. Either Stripe did not really apply it, or it applied it and the read
is stale. **Treat it as not applied until proven otherwise.** The
agent already refuses to claim the action succeeded, so the customer has not been
told a lie; the risk is a real action nobody follows up on.

**Check first.**

```bash
psql "$DATABASE_URL" -tAc "
  select id, run_id, tool_name, status, verify_observed, error_code, finished_at
  from tool_executions
  where verified = false and finished_at > now() - interval '24 hours'
  order by finished_at desc limit 20"
```

Open the run in the operator UI: `$KORA_APP_URL/ops/conversations/<conversation_id>`.
The timeline shows the tool input, the response, and what the verification read
back.

Then ask Stripe directly for the object the run claims it wrote — the refund id,
the subscription id — in the Stripe dashboard for that tenant's account, or with
that tenant's key. Do not take the id from the customer's message; take it from
the tool execution row.

**Mitigate.**

- Stripe has the record: the write landed and the read was stale. No customer
  action. If this happens repeatedly, the verification read is racing the write
  and needs a delay.
- Stripe does not have the record: the write did not land. Redo it by hand in
  Stripe, or reply to the customer and let the agent try again on the next turn.
  The idempotency key stops a duplicate.
- The refund exists but is `pending`: that is not a failure. See
  [Stripe: refund stuck pending](#stripe-refund-stuck-pending).
- Many at once: Stripe is degraded. See
  [Stripe is unreachable](#stripe-is-unreachable).

---

## Policy compliance is below 100%

**What it means.** A run broke a rule. This is the most serious signal in the
system, and the benchmark gate treats anything below 100% as a merge blocker.

**Check first.**

```bash
psql "$DATABASE_URL" -tAc "
  select run_id, rule_id, action, decision, reason, created_at
  from policy_checks
  where decision = 'deny' and created_at > now() - interval '24 hours'
  order by created_at desc limit 20"

psql "$DATABASE_URL" -tAc "
  select run_id, failure_codes, created_at
  from evaluations
  where 'POLICY_FAILURE' = any(failure_codes)
    and created_at > now() - interval '24 hours'
  order by created_at desc limit 20"
```

For each offending run, open `$KORA_APP_URL/ops/conversations/<id>` and read the
policy panel: which rule fired, on what facts, and what the pipeline did next.

**Mitigate.**

1. Contain it now. Set `KORA_DEPLOYMENT_MODE=human_approval` and restart the web
   and worker processes. Every high-impact write then waits for a person
   regardless of what the policy says.
2. If the wrong rule shipped, roll the agent version back:
   `pnpm kora agent:rollback`. In-flight runs finish on the version they started
   with.
3. Work out which of the two it was: a rule that did not fire, or a rule that
   fired and was ignored. `policy_checks.missing_facts` being non-empty means the
   rule could not decide because a fact was absent, which is the more dangerous
   case.
4. Add the case to `benchmarks/` before fixing it, so the gate catches it next
   time.

---

## Stripe is unreachable

**What it means.** Every tool that reads or writes Stripe fails. Runs escalate
instead of resolving. The circuit breaker opens after five failures in a minute
and stays open for thirty seconds at a time before it admits one probe, which is
intended: it stops the agent hammering a dead dependency.

This section is for a broad outage. For the narrower cases see
[revoked or wrong key](#stripe-revoked-wrong-or-under-scoped-key) and
[rate limit](#stripe-rate-limit-429).

**Check first.**

```bash
curl -s https://status.stripe.com/current                                 # is it Stripe
curl -s -b cookies.txt "$KORA_APP_URL/api/status" | python3 -m json.tool  # look at breakers
psql "$DATABASE_URL" -tAc "
  select tool_name, error_code, count(*)
  from tool_executions
  where finished_at > now() - interval '30 minutes' and status <> 'ok'
  group by 1,2 order by 3 desc"
```

`UPSTREAM_5XX` and `UPSTREAM_TIMEOUT` spread across every tool is the dependency.
`CONFIG_ERROR` concentrated on one tenant is that tenant's key, not an outage.
`BREAKER_STUCK_OPEN` in the logs means a breaker has been open for more than ten
minutes and the dependency is not recovering.

**Mitigate.**

- This is an upstream incident. Set `KORA_DEPLOYMENT_MODE=simulation` if you need
  reads to keep working while writes are suppressed and recorded rather than
  attempted.
- Do not clear the breaker by hand while Stripe is still failing. It closes on
  its own after one successful probe.
- Refunds and cancellations already issued are safe. Every write carries the
  claim key as its Stripe idempotency key, so a retry after recovery returns the
  original result rather than acting twice.
- If a suite was running, check no fault injection is still switched on before
  treating this as a real incident.

---

## A model provider is down

**What it means.** `/readyz` returns 503 with `checks.model.ok = false`, or
`llm_calls` fills with failures. With `KORA_MODEL_PROVIDER=mock` this cannot
happen: the mock provider answers in process and is never probed over the
network.

**Check first.**

```bash
curl -s "$KORA_APP_URL/readyz" | python3 -m json.tool
psql "$DATABASE_URL" -tAc "
  select provider, status, error_code, count(*)
  from llm_calls
  where created_at > now() - interval '30 minutes'
  group by 1,2,3 order by 4 desc"
pnpm kora smoke:model
```

**Mitigate.**

- If `KORA_MODEL_AGENT_FALLBACK` is configured, the gateway has already switched
  to it and `provider` in `llm_calls` reads `fallback:*`. Nothing to do except
  watch the cost, which will be different.
- If there is no fallback, set one and restart, or switch
  `KORA_MODEL_PROVIDER=mock` to keep the system answering deterministically while
  the provider recovers. Quality drops; nothing breaks.
- Rate limiting rather than an outage looks like intermittent failures with the
  breaker flapping. Lower traffic or raise the quota; restarting does not help.
- `/readyz` caches for 10 seconds, so a recovering provider takes up to 10
  seconds to show as ready. That is deliberate.

---

## Stripe: revoked, wrong, or under-scoped key

**Symptom.** Money writes for one tenant all fail at once with
`CONFIG_ERROR`. The chat says "Kora cannot reach Stripe with this key. Check
the key and its permissions" — never a customer-facing failure, never a
stack trace. Other tenants are unaffected.

**Cause.** The tenant's restricted Stripe key was revoked, pasted wrong, or is
missing a scope (Customers read, Subscriptions read/write, Invoices read,
Charges read, PaymentIntents read, Refunds read/write, Products and Prices
read). `CONFIG_ERROR` never counts toward the circuit breaker and is never
retried: retrying a bad key burns no money but hides the real fix.

**Action.**

1. Confirm it is the key and not Stripe: `GET /readyz` is green and other
   tenants' writes succeed.
2. Find the failing tenant in `tool_executions` by `error_code =
   'CONFIG_ERROR'` over the last hour.
3. Re-set the tenant key, verifying the scopes above:

   ```bash
   pnpm kora stripe:set-key --tenant <tenant_id> --key rk_test_...
   ```

   It is stored encrypted in `tenant_settings`. The runtime key must not be able
   to create customers — that needs the broader dev key used only by the
   fixtures script.
4. **Restart the web and worker processes.** The provider caches the Stripe
   client it built from the old key for the life of the process, and
   `stripe:set-key` runs in a different process, so a rotated key is not picked
   up until a restart. Skipping this looks exactly like the new key being wrong
   too.
5. Re-run one read (`get_subscription`) before letting queued writes proceed.

A tenant with **no** key at all is a different path with the same code: the
pipeline refuses the write before it claims an idempotency key, escalates, and
records `CONFIG_ERROR`. Nothing is sent to Stripe.

---

## Stripe: rate limit (429)

**Symptom.** Writes intermittently fail with `UPSTREAM_5XX`, the breaker for
one `(tenant, tool)` pair flaps open and closed, resolution rate dips across
all intents rather than one.

**Cause.** Stripe returned 429. The provider maps it to `UPSTREAM_5XX`,
retryable with backoff, counting toward the breaker — same as a 500. A dip
across every intent points at the dependency, not at a policy or version
(see [Verified resolution fell overnight](#verified-resolution-fell-overnight)).

**Action.**

1. Check `/api/status` for flapping breakers and `tool_executions` for a
   spread of `UPSTREAM_5XX` across tools.
2. Do not clear the breaker by hand and do not restart to "unblock" traffic:
   the breaker closes on its own after one successful probe, and forcing it
   closed sends real money actions at a throttled API.
3. Lower traffic or raise the Stripe quota. Restarting changes nothing.
4. If the rate was set deliberately for a test, check no fault override is
   still on before treating it as an incident.

---

## Stripe: webhook down or rejected

**Symptom.** Refunds sit in `pending` past their expected confirmation, runs
stay in "waiting on Stripe", and no reconciliation step appears in the traces.
If signatures fail, the endpoint returns 400 on every delivery and every one
looks unprocessed.

The endpoint handles two event families and ignores everything else:
`refund.created`, `refund.updated`, `refund.failed`, and
`customer.subscription.updated`, `customer.subscription.deleted`. A refund
reaching `succeeded` arrives as `refund.updated` carrying the new status —
there is no `refund.succeeded` event, so do not go looking for one in the
Stripe delivery log.

**Cause.** One of: the webhook route is down (deploy, crash), the endpoint
secret is wrong or rotated (signature verification fails), or Stripe cannot
reach the endpoint (network, wrong URL). Duplicate `event.id` deliveries are
normal and are no-ops by design — do not mistake the dedupe log for an
outage.

**Action.**

1. `curl -s "$KORA_APP_URL/healthz"` — is the app up at all.
2. Check `STRIPE_WEBHOOK_SECRET` matches the Stripe dashboard value for this
   endpoint; a rotation without a matching config change rejects everything.
   It takes either the raw `whsec_…` value or a `v1.…` blob from the secret
   helper. Unset, the route answers 500 `WEBHOOK_NOT_CONFIGURED` and processes
   nothing — it never falls through to accepting unsigned events.
3. Check Stripe's delivery log for the endpoint: failed deliveries with
   retries means reachability; 400s on every delivery means signatures. A
   signature more than five minutes old is also rejected, so a badly skewed
   clock on the app host looks exactly like a wrong secret.
4. Check what actually arrived:

   ```bash
   psql "$DATABASE_URL" -tAc "
     select type, outcome, count(*), max(created_at)
     from stripe_webhook_events
     where created_at > now() - interval '1 day' group by 1,2"
   ```

5. After recovery, Stripe redelivers. The handler claims each `event.id` once,
   so redelivery is a no-op — do not manually flip verifications.
6. If events were lost (endpoint deleted, retention passed), read the open
   refunds back from Stripe per run and reconcile by hand from what Stripe
   returns, not from memory.

---

## Stripe: refund stuck pending

**Symptom.** A refund the policy allowed shows `pending` (or
`requires_action`), verify reads it back as not-`succeeded`, and the customer
sees "a person will confirm" — never "refund succeeded".

**Cause.** This is the system working as designed. A refund whose status is
not `succeeded` is not success: `create_refund.verify` passes only on
`status === 'succeeded'` with amount and currency matching the request to the
minor unit. Anything else resolves to `verified: false` and escalates, and
the webhook flips it later.

**Action.**

1. Open the run in the operator UI and read the timeline: the refund id, the
   requested amount, and what the read-back returned.
2. Ask Stripe directly for that refund id. Trust the record, not the
   customer's message and not the agent's draft.
3. `succeeded`: if the webhook already reconciled, the trace shows it. If
   not (webhook down), record the confirmation on the run by hand.
4. Still `pending`: wait. Do not create a second refund — the claim key and
   the Stripe idempotency key mean a retry returns the original, but a manual
   re-issue with different input is a genuinely different action and can
   double-pay.
5. `failed` or `canceled`: tell the customer plainly, with the reference,
   and let the agent try again on the next turn or redo it in Stripe.
6. Many stuck at once: treat as [webhook down](#stripe-webhook-down-or-rejected),
   not as N individual refund problems.

A refund that reaches `succeeded` while the webhook is working needs no action
at all: the handler flips the execution's verification to confirmed and writes a
`verify` step into the trace, so the run shows what happened and when. What you
are looking at here is either a refund Stripe has genuinely not settled, or a
webhook that never arrived.

---

## A migration failed halfway

**What it means.** `migrate-job.sh` exited non-zero. The advisory lock is
released as soon as the psql session ends, so a retry is not blocked by the
failed run.

Drizzle applies every pending migration inside one transaction, so a failure
normally leaves the schema exactly where it started. "Halfway" is only possible
when a statement cannot run in a transaction — `CREATE INDEX CONCURRENTLY`,
`ALTER TYPE ... ADD VALUE` — so check for those first.

**Check first.**

```bash
psql "$DATABASE_URL" -tAc "
  select id, hash, to_timestamp(created_at/1000) from drizzle.__drizzle_migrations
  order by id desc limit 5"
ls packages/db/migrations/*.sql | tail -5
```

Compare the count of applied rows with the number of migration files. The last
applied row is the last one that completed.

Confirm nothing is still holding the lock:

```bash
psql "$DATABASE_URL" -tAc "
  select pid, mode, granted, query_start from pg_locks l
  join pg_stat_activity a using (pid)
  where l.locktype = 'advisory'"
```

**Mitigate.**

1. Read the error from the failed job before touching anything. Most failures are
   a constraint that the existing data violates, and the fix is to the data, not
   the migration.
2. If nothing in the failed migration was non-transactional, the transaction
   rolled back and nothing was applied. Fix the cause and run `pnpm migrate:job`
   again.
3. If it is genuinely half applied, undo the objects it created by hand, then
   rerun. Do not edit `drizzle.__drizzle_migrations` to skip it: the next
   migration will then run against a schema it was never written for.
4. **The previous release is still serving.** That is normal and safe as long as
   the migration follows the backward compatibility rule in
   `docs/10-deployment/README.md`: nullable columns first, backfill, require them
   next release. If the migration broke that rule, roll the *application* forward
   rather than rolling the schema back; a schema rollback loses data.
5. If a lock is genuinely stuck from a killed process,
   `select pg_terminate_backend(<pid>)` releases it. Check the process really is
   gone first.

---

## Restoring from backup

An untested backup is not a backup. `pnpm backup:verify` dumps, restores into a
scratch database, compares row counts on `agent_runs`, `evaluations` and
`policy_versions`, and drops the scratch database. Run it monthly, and before any
release that changes the schema.

To restore for real:

```bash
pg_dump --format=custom --file=kora.dump "$DATABASE_URL"     # the state you are replacing
psql "$DATABASE_URL" -c 'create database kora_restored'
pg_restore --no-owner --no-privileges --dbname="<url ending in /kora_restored>" backup.dump
```

Point `DATABASE_URL` at the restored database, run `pnpm migrate:job` to bring
the schema forward, and restart. Take the current database's dump before
restoring over anything: the state you are about to replace is evidence.

## What is deliberately not alerted

**Judge kappa.** `pnpm kora judge:calibrate` gates on Cohen's kappa at 0.6 per
criterion, but only once a criterion has at least 100 labels. Below that, kappa
swings on a single disagreement and gating there would disable criteria at
random. There is no runtime alert for kappa because nothing writes calibration
results between runs: an alert reading a table nobody fills would look like
monitoring and be nothing. Run the calibration monthly; it exits non-zero when
a criterion falls below the gate.

The gold set in this repository is 30 traces and its labels are derived from
the same evidence the judge reads, so the agreement number measures whether the
judge reads a trace consistently, not whether it agrees with a person. Growing
it to 200 machine-labelled traces would cross the gating threshold and turn on
a gate based on self-consistency, which is worse than no gate. Replace the
labels by hand before trusting the number, then grow it.

**OpenTelemetry export.** Logs are structured and carry `traceId` on every
line, and `run_steps` is the durable trace. There is no OTLP exporter: the
database is the source of truth here, and adding an exporter with no collector
to receive it would be configuration, not observability.
