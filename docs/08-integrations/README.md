# Integrations

One: the Acme Store mock commerce service in `services/mock-commerce`.

It is a real HTTP service with its own tables, not a stub. That matters, because
every property Kora claims about writes — idempotency, verification, retries,
timeouts — is only meaningful against something that can actually fail.

## The chokepoint

Only `packages/tools/src/` may reach it. `scripts/check-acme-imports.ts` fails
the build if anything else imports the client or even mentions `ACME_BASE_URL`.
Without it, one direct call slips in, then another, and the guarantee that every
write is checked and verified quietly stops being true.

`packages/evaluation` needs to read Acme too, to check what actually happened.
It goes through `acmeReader` and `acmeAdmin`, re-exported from `@kora/tools`, so
there is still exactly one client.

## Its own idempotency

`POST /replacements`, `/refunds` and `/cancellations` all require an
`idempotency-key` header and store it with a unique index. Kora's idempotency
layer and Acme's are independent on purpose: a real business API has its own, and
building against one that does not teaches the wrong lesson.

## Fault injection

Six faults: `timeout`, `500`, `slow`, `malformed`, `duplicate`, `stale`.

Two ways to trigger one:

- **Per request**, with an `x-acme-fault` header. Deterministic, used by the
  acceptance scenarios that assert a specific failure is handled.
- **At random**, with a fault rate. Used by chaos testing.

Random injection only picks the transport faults (`timeout`, `500`, `slow`). The
write faults change stored state, so firing them at random would make every read
path non-deterministic and the benchmark would stop measuring the agent.

The rate comes from `ACME_FAULT_RATE`, or from `POST /admin/fault-rate` at
runtime. The runtime override exists because `serverEnv()` is parsed once per
process, so a chaos run in a different process cannot change the service's
environment variable.

## Admin endpoints

| Route | Use |
|---|---|
| `POST /admin/reset` | reseed everything, or just the named orders |
| `POST /admin/fault-rate` | set or clear the random fault rate |
| `GET /admin/request-log` | every request the service received, with what fault fired and whether it reached business logic |

The request log is what makes the shadow-mode assertion trustworthy. Counting
writes from Kora's own records would only prove Kora believes it wrote nothing.

Reset is scoped to the orders a scenario touches, so one scenario's reset does not
wipe another's fixture. The benchmark also takes a per-order lock, because
scenarios sharing an order race otherwise: that alone took the benchmark from
74/120 to 112/120.

## Seed data

Deterministic, the same after every reset:

| Order | Item | Amount | Delivered | Why it exists |
|---|---|---|---|---|
| `9832` | Coffee machine | INR 3,499 | 4 days ago | the happy path |
| `9833` | Espresso machine | INR 8,999 | 3 days ago | above the approval threshold |
| `9834` | Kettle | INR 2,199 | 12 days ago | outside the 7 day window |
| `9835` | Gift card | INR 1,000 | 2 days ago | non-returnable category |
| `9836` | Blender | INR 4,299 | 2 days ago | already has replacement `REP-0001` |
| `9999` | — | | | does not exist |

## Running it

Use `start`, not `dev`, whenever a test suite is running. `dev` is `tsx watch`
and restarts the service on every edit under `packages/`, which looks exactly
like a flaky test. See
[run one thing at a time](../09-testing/README.md#run-one-thing-at-a-time).
