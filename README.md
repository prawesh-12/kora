# Kora

Kora is a customer support agent. A customer describes a problem, Kora looks up
their order, checks the rules, does the thing if the rules allow it, and then
reads the order back to make sure it really happened before telling the customer.

That last part is the point. It does not say a replacement was created because it
sent the request. It says so because it looked.

## Running it

You need Node 24 or newer, pnpm, and Docker. You do not need an API key. Kora
ships with an offline model so everything works with no account anywhere.

```bash
cp .env.example .env
pnpm install
pnpm infra:reset                            # database and cache, migrated and seeded

pnpm --filter @kora/mock-commerce start &   # the pretend shop, on :4001
pnpm --filter @kora/worker start &          # background jobs
pnpm --filter web dev &                     # Kora, on :3000

pnpm kora scenarios                         # should print 12 of 12 passed
```

Then open http://localhost:3000/chat and say:

> My coffee machine from order 9832 arrived broken. I want a replacement.

To see the operator side, sign in at http://localhost:3000/login with
`operator@acme.test` and `operator-password`.

## What is in here

```
apps/web                  the chat and the operator screens
packages/core             types, money, ids, the rules engine
packages/db               database schema and queries
packages/tools            the nine things the agent can do
packages/ai               the agent itself
packages/evaluation       scoring, benchmarks, replay
services/mock-commerce    a pretend shop to act against
services/worker           background jobs
config                    the agent, the rules, the knowledge it reads
docs                      everything else
```

## Common commands

```bash
pnpm test           # all the tests
pnpm lint           # formatting plus a few structural checks
pnpm kora bench     # 120 scenarios, scored
pnpm kora replay    # re-run old conversations against a new version
pnpm kora chaos     # break things on purpose and check nothing goes wrong
```

`pnpm kora` on its own lists the rest.

## Where to read more

Everything else is in `docs/`.

| You want to | Read |
|---|---|
| Set it up properly | `docs/QUICKSTART.md` |
| Understand how it fits together | `docs/00-overview/README.md` |
| Know what works and what does not | `docs/00-overview/m2-acceptance.md` |
| Know why something was built that way | `docs/decisions.md` |
| Fix it when it breaks | `docs/runbook.md` |
| Ship it | `docs/10-deployment/README.md` |

`docs/` is not committed to this repository. If you cloned this and the folder is
missing, ask whoever gave you the code for it.
