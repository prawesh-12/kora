# Quickstart

From a clean clone to the full acceptance suite passing.

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
pnpm infra:reset                      # postgres + redis, migrate, seed, ingest
pnpm --filter @kora/mock-commerce start & # Acme Store on :4001
pnpm --filter @kora/worker start &        # background jobs
pnpm --filter web dev &                   # Kora on :3000
pnpm kora scenarios
```

`pnpm kora scenarios` prints a table and exits 0 when all twelve pass.

`.env.example` sets `DATABASE_APP_URL` to the `kora_app` role, which is what
enforces row-level security at runtime. Migrations keep using `DATABASE_URL`,
because `kora_app` deliberately cannot run DDL. If you unset it the application
connects as the owner, row-level security stops applying, and a warning says so
on every start.

## See it work

Open [http://localhost:3000/chat](http://localhost:3000/chat) and send:

> My coffee machine from order 9832 arrived broken. I want a replacement.

Kora looks the order up, retrieves the policy, checks the rules, creates the
replacement, reads it back to confirm it landed, and replies with the real
replacement reference.

Then try these two:

| Message                                                                     | What you should see                                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| The espresso machine in order 9833 came smashed. Please send a replacement. | Stops and waits. INR 8,999 is over the INR 5,000 threshold, so a person decides. Nothing is written until they do. |
| The kettle from order 9834 was damaged. Send me a new one.                  | A plain explanation that the 7 day window has passed. No escalation: a correct refusal is a complete answer.       |

To approve the 9833 case, log in at [http://localhost:3000/login](http://localhost:3000/login) with
`operator@acme.test` / `operator-password`, open **Approvals**, and approve it.
The run resumes and creates exactly one replacement.

Every run is inspectable at `/ops/conversations/<id>`: the conversation on the
left, every step with timings in the middle, the retrieved policy and the seven
evaluation checks on the right.

## Commands

| Command                               | What it does                                         |
| ------------------------------------- | ---------------------------------------------------- |
| `pnpm infra:up`                     | Start postgres and redis, wait for healthy           |
| `pnpm infra:down`                   | Stop them, keep the data                             |
| `pnpm infra:reset`                  | Destroy volumes, recreate, migrate, seed, ingest     |
| `pnpm kora migrate`                 | Apply database migrations                            |
| `pnpm kora seed`                    | Insert the tenant and the operator user (idempotent) |
| `pnpm kora ingest config/knowledge` | Ingest the policy documents (skips unchanged files)  |
| `pnpm worker`                       | Start the background worker                          |
| `pnpm kora scenarios`               | Run the acceptance suite                             |
| `pnpm kora bench`                   | Run the 120-scenario benchmark                       |
| `pnpm kora judge:goldset`           | Capture recent runs as a judge gold set              |
| `pnpm kora judge:calibrate`         | Score the judge against the gold set                 |
| `pnpm kora approvals:expire`        | Sweep approvals past their TTL                       |
| `pnpm kora scenarios --id H1`       | Run one scenario                                     |
| `pnpm kora scenarios --repeat 3`    | Run it three times, to catch flakes                  |
| `pnpm kora idempotency:cleanup`     | Delete expired idempotency claims                    |
| `pnpm kora smoke:model`             | One real model call, writes an`llm_calls` row      |
| `pnpm test`                         | Every package test suite                             |
| `pnpm lint`                         | Biome, plus the dependency and business-API guards   |

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
| `full`           | The policy engine decides. High-value replacements still need a person.**The default.**             |
| `human_approval` | Every high-impact write needs a person, whatever the policy says.                                         |
| `simulation`     | Reads run normally; writes are skipped and recorded as`simulated`. Nothing reaches the business system. |

## Troubleshooting

**Port 5432 or 6379 already in use.** `pnpm infra:up` names the process holding
it. Stop that, or change the published port in
`infra/docker/docker-compose.yml`.

**`pnpm kora scenarios` says Acme is not reachable.** Start it:
`pnpm --filter @kora/mock-commerce start`. The runner checks before scenario 1 so
you get one clear message instead of twelve confusing failures.

**`pnpm kora scenarios` says the knowledge base is empty.** Run
`pnpm kora ingest config/knowledge`. The runner refuses to start without it,
because N10 would otherwise pass for the wrong reason.

**The Acme service keeps restarting mid-test.** `pnpm --filter @kora/mock-commerce dev`
watches `packages/` and reloads whenever a workspace source file changes, which looks
like a flaky test. Use `start` instead while a suite is running.

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
pnpm kora scenarios --mode shadow             # prove zero writes reach Acme
pnpm kora chaos --fault-rate=0.2 --repeat=3   # nothing else may run at the same time
pnpm kora alerts:test                         # every rule, now, with drill paths
pnpm kora agent:versions                      # list versions, active first
pnpm kora agent:promote --version <id> --actor <email>
pnpm kora agent:rollback                      # no gates, no redeploy
pnpm kora security:isolation                  # every API route is guarded or listed public
pnpm migrate:job                              # migrate under an advisory lock
pnpm backup:verify                            # restore into a scratch database and count rows
```

`pnpm lint` runs Biome plus three structural checks: the dependency direction,
the business-API chokepoint, and the route isolation guard. Adding an unguarded
API route fails the build, which is the point — the failure comes from adding
the route, not from remembering to add a test for it.
