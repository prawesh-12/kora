# Quickstart

From a clean clone to the acceptance suite passing.

## What you need

- Node 24 or newer (`.nvmrc` pins 24)
- pnpm 10 or newer
- Docker, running

Nothing else. **No LLM API key is required.** Kora ships a deterministic offline
model provider, and that is the default. See
[Running with a real model](#running-with-a-real-model) to switch.

## Steps

```bash
git clone <repo> && cd kora
cp .env.example .env
pnpm install
pnpm infra:reset                            # postgres + redis, migrate, seed, ingest
pnpm kora stripe:set-key --key rk_test_...  # this tenant's restricted Stripe key
pnpm --filter @kora/worker start &          # background jobs
pnpm --filter web dev &                     # Kora on :3000
pnpm kora scenarios
```

`pnpm kora scenarios` prints one row per scenario and exits 0 when all 22 pass.

### The Stripe key

The key is a **restricted, test-mode** key. It is encrypted with `KORA_SECRET_KEY`
and stored per tenant in `tenant_settings`. Set it once; `pnpm kora stripe:set-key`
also reads `STRIPE_TENANT_KEY` from `.env` if you would rather keep it there.

It needs Customers read, Subscriptions read and write, Invoices read, Charges
read, PaymentIntents read, Refunds read and write, and Products and Prices read.
It must **not** be able to create customers.

Without a key, reads still work and every money write fails closed with
`CONFIG_ERROR` and escalates. That is the designed behaviour, not a bug, but it
means nothing gets refunded.

The provider caches the Stripe client per tenant for the life of the process, so
after changing a key, restart the web and worker processes.

`.env.example` sets `DATABASE_APP_URL` to the `kora_app` role, which is what
enforces row-level security at runtime. Migrations keep using `DATABASE_URL`,
because `kora_app` deliberately cannot run DDL. If you unset it the application
connects as the owner, row-level security stops applying, and a warning says so
on every start.

## See it work

The chat talks to the real Stripe test-mode account behind your key, so you need
a customer with a subscription and at least one paid invoice in that account. The
built-in fixtures script does not create one yet — see
[Status](00-overview/status.md#what-is-not-proven) — so create them in the Stripe
dashboard, or point the key at a test account you already seeded.

With that in place, open [http://localhost:3000/chat](http://localhost:3000/chat)
and send:

> I want a refund for my last payment.

Kora looks the subscription up, finds the invoice and the charge behind it,
retrieves the policy, checks the rules, creates the refund, reads it back out of
Stripe to confirm it landed, and replies with the real refund reference.

The three rules worth trying, from `config/policies/refunds.yaml`:

| Situation                                              | What you should see                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| A charge more than 30 days old                         | A plain explanation that the window has passed. No escalation: a correct refusal is a complete answer.             |
| A refund at or above INR 5,000                         | Stops and waits. `refund_high_value` sends it to a person. Nothing is written until they decide.                   |
| An amount above what is still refundable on the charge | Denied by `refund_exceeds_refundable`, and the reply states what is actually left.                                 |

To approve the held case, log in at
[http://localhost:3000/login](http://localhost:3000/login) with the credentials
from your `.env` (`KORA_SEED_OPERATOR_EMAIL` and `KORA_SEED_OPERATOR_PASSWORD`),
open **Approvals**, and approve it. The run resumes and creates exactly one
refund.

Every run is inspectable at `/ops/conversations/<id>`: the conversation on the
left, every step with timings in the middle, the retrieved policy and the nine
evaluation checks on the right. A completed money action renders a Proof Card:
what was requested and which rule allowed it, the write with the real Stripe id,
and the read-back that confirmed it.

If you have no Stripe account to point at, `pnpm kora scenarios` is the honest
substitute. It runs the same agent, the same policies and the same pipeline
against an in-memory stub behind the provider interface, so it exercises
everything except Stripe itself.

## Commands

| Command                               | What it does                                         |
| ------------------------------------- | ---------------------------------------------------- |
| `pnpm infra:up`                     | Start postgres and redis, wait for healthy           |
| `pnpm infra:down`                   | Stop them, keep the data                             |
| `pnpm infra:reset`                  | Destroy volumes, recreate, migrate, seed, ingest     |
| `pnpm kora migrate`                 | Apply database migrations                            |
| `pnpm kora seed`                    | Insert the tenant, the operator, and the fixtures (idempotent) |
| `pnpm kora ingest config/knowledge` | Ingest the policy documents (skips unchanged files)  |
| `pnpm worker`                       | Start the background worker                          |
| `pnpm kora scenarios`               | Run the acceptance suite                             |
| `pnpm kora bench`                   | Run and score the 22-scenario suite                  |
| `pnpm kora judge:goldset`           | Capture recent runs as a judge gold set              |
| `pnpm kora judge:calibrate`         | Score the judge against the gold set                 |
| `pnpm kora approvals:expire`        | Sweep approvals past their TTL                       |
| `pnpm kora scenarios --id S1`       | Run one scenario                                     |
| `pnpm kora scenarios --repeat 3`    | Run it three times, to catch flakes                  |
| `pnpm kora idempotency:cleanup`     | Delete expired idempotency claims                    |
| `pnpm kora smoke:model`             | One real model call, writes an`llm_calls` row      |
| `pnpm test`                         | Every package test suite                             |
| `pnpm lint`                         | Biome, plus five structural checks                   |

## Running with a real model

Set three variables in `.env`:

```bash
KORA_MODEL_PROVIDER=openai            # or anthropic
KORA_MODEL_AGENT=<a tool-calling model id>
KORA_MODEL_CLASSIFIER=<a cheap, fast model id>
KORA_MODEL_EMBEDDING=<must produce 1536 dimensions>
OPENAI_API_KEY=...
```

The embedding dimension is load-bearing: the schema declares `vector(1536)`.
Changing the embedding model means changing the column, the index, and
re-embedding everything. Add prices for your model ids to `config/pricing.json`,
or cost lands as null and you get one warning per process.

After switching, re-run `pnpm kora ingest config/knowledge` — existing chunks
were embedded by the previous model and are not comparable.

## Deployment modes

`KORA_DEPLOYMENT_MODE` controls how far the agent is allowed to go on its own.

| Mode               | Behaviour                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `full`           | The policy engine decides. High-value refunds still need a person.**The default.** |
| `human_approval` | Every money write needs a person, whatever the policy says.                              |
| `simulation`     | Reads run normally; writes are skipped and recorded as`simulated`. Nothing reaches Stripe. |

`shadow` and `limited` sit between these. See
[the deployment ladder](06-backend/deployment-ladder.md).

## Troubleshooting

**Port 5432 or 6379 already in use.** `pnpm infra:up` names the process holding
it. Stop that, or change the published port in
`infra/docker/docker-compose.yml`.

**`pnpm kora scenarios` says the knowledge base is empty.** Run
`pnpm kora ingest config/knowledge`. The runner refuses to start without it,
because a reads-only scenario would otherwise pass for the wrong reason.

**A money write fails with `CONFIG_ERROR`.** The tenant has no Stripe key, or the
one it has is wrong, revoked, or under-scoped. Set it with
`pnpm kora stripe:set-key` and restart the web and worker processes — the
provider caches its Stripe client per tenant for the life of the process.

**Evaluation never appears for a run.** The worker writes it. Start it with
`pnpm worker`. If it is not running, the chat route falls back to evaluating
inline, and any event that missed the queue is picked up by the catch-up job
within five minutes of the worker starting.

**Sign-in returns 401.** The operator row is created by `pnpm kora seed`. If you
reset the database without re-seeding, there is no operator.

## More commands

```bash
pnpm kora replay --limit 100                  # self-replay; exits non-zero on drift
pnpm kora replay --from <id> --against <id>   # compare two versions
pnpm kora scenarios --mode shadow             # prove zero writes reach Stripe
pnpm kora chaos --fault-rate=0.2 --repeat=3   # nothing else may run at the same time
pnpm kora alerts:test                         # every rule, now, with drill paths
pnpm kora agent:versions                      # list versions, active first
pnpm kora agent:promote --version <id> --actor <email>
pnpm kora agent:rollback                      # no gates, no redeploy
pnpm kora security:isolation                  # every API route is guarded or listed public
pnpm migrate:job                              # migrate under an advisory lock
pnpm backup:verify                            # restore into a scratch database and count rows
```

`pnpm lint` runs Biome plus five structural checks: the UI gate, the marketing
gate, the dependency direction, the Stripe chokepoint (only `packages/tools` may
import the SDK or the provider), and the route isolation guard. Adding an
unguarded API route fails the build, which is the point — the failure comes from
adding the route, not from remembering to add a test for it.
