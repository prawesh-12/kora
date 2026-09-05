# Kora

Kora is a money-operations agent for subscription businesses. A customer asks for
a refund, a cancellation, or a plan change; Kora looks their subscription up in
Stripe, checks the rules, does the thing if the rules allow it, and then reads it
back out of Stripe to make sure it really happened before telling the customer.

That last part is the point. It does not say a refund was issued because it sent
the request. It says so because it looked.

Stripe Billing, test mode.

---

## The operator side

Every run is recorded and scored, so you can see what the agent did and whether it
worked.

![The Kora operator overview: the verified resolution rate, total and eligible runs, the escalation rate, and the ten most recent runs](public/kora_operator_overview_page.png)

---

## Running it

You need Node 24 or newer, pnpm, and Docker. You do not need an LLM API key. Kora
ships with an offline model, so everything runs with no account anywhere.

```bash
cp .env.example .env
pnpm install
pnpm infra:reset                            # database and cache, migrated and seeded

pnpm kora stripe:set-key --key rk_test_...  # a restricted test-mode key for this tenant

pnpm --filter @kora/worker start &          # background jobs
pnpm --filter web dev &                     # Kora, on :3000

pnpm kora scenarios                         # the acceptance suite, 22 scenarios
```

The key is stored encrypted, per tenant. Without one, every money write fails
closed and escalates rather than guessing — which is the correct behaviour, but
it means nothing gets refunded.

Then open http://localhost:3000/chat and say:

> I want a refund for my last payment.

To see the operator side, sign in at http://localhost:3000/login with the
operator credentials from your `.env` (`KORA_SEED_OPERATOR_EMAIL` and
`KORA_SEED_OPERATOR_PASSWORD`).

---

## What is in here

```
apps/web                  the chat and the operator screens
packages/core             types, money, ids, the rules engine, secrets
packages/db               database tables and queries
packages/tools            the Stripe provider and the eleven things the agent can do
packages/ai               the agent itself
packages/evaluation       scoring the agent and re-running old conversations
services/worker           background jobs
config                    the agent, the rules, the knowledge it reads
scenarios                 the acceptance suite
docs                      everything else
```

Only `packages/tools` is allowed to import the Stripe SDK. `pnpm lint` fails the
build if anything else does.

---

## Common commands

```bash
pnpm test           # all the tests
pnpm lint           # formatting plus five structural checks
pnpm kora scenarios # the acceptance suite
pnpm kora bench     # the benchmark, scored
pnpm kora replay    # run old conversations again against a new version
pnpm kora chaos     # break things on purpose and check nothing goes wrong
```

`pnpm kora` on its own lists the rest.

---

## When money calls fail

Kora fails closed: a dead dependency means escalation, never a guessed answer
or a duplicate write. What each failure looks like and what to do:

| Symptom | Likely cause | First action |
|---|---|---|
| "Kora cannot reach Stripe with this key" | revoked, wrong, or under-scoped tenant key | check the key and its permissions, re-set it, retry |
| Refunds timing out, breaker flapping | Stripe rate limit (429) | stop retrying by hand, let the backoff work, lower traffic or raise quota |
| Refund approved but never confirmed | webhook down or refund stuck `pending` | check the webhook endpoint and signature secret, re-fetch the refund in Stripe |

Full steps for each are in `docs/runbook.md`.

---

## Where to read more

Everything else is in `docs/`.

| You want to | Read |
|---|---|
| Set it up properly | `docs/QUICKSTART.md` |
| Understand how it fits together | `docs/00-overview/README.md` |
| Know what works and what does not | `docs/00-overview/status.md` |
| Know why something was built that way | `docs/decisions.md` |
| Fix it when it breaks | `docs/runbook.md` |
| Put it on a server | `docs/10-deployment/README.md` |
