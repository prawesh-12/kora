# The domain

What Kora is actually reasoning about: intents, tools, facts and policies.

## Intents

Six. Classified once per turn, with a confidence threshold below which the run
hands over rather than guesses.

| Intent | What it means | Can it write? |
|---|---|---|
| `REFUND_REQUEST` | give me my money back | refund |
| `CANCEL_SUBSCRIPTION` | stop charging me | cancellation |
| `CHANGE_PLAN` | move me up or down a tier | plan change |
| `BILLING_QUESTION` | why was I charged this | never |
| `HUMAN_REQUEST` | I want a person | hands over immediately |
| `OUT_OF_SCOPE` | anything else | hands over immediately |

`READ_ONLY_INTENTS` (`BILLING_QUESTION`, `HUMAN_REQUEST`, `OUT_OF_SCOPE`) and
`HANDOVER_INTENTS` (`HUMAN_REQUEST`, `OUT_OF_SCOPE`) are enforced in code, not in
the prompt. `gateToolsByState` removes every write tool from what the model can
even see for a read-only intent. A tool the model cannot see is a tool it cannot
misuse, and that removes a whole class of error without an instruction to follow.

## Tools

Eleven, each with a zod input and output schema, a permission, a timeout and a
retry class.

| Tool | Side effect | Permission | Verified by reading back |
|---|---|---|---|
| `get_subscription` | read | `subscriptions:read` | — |
| `get_customer` | read | `customers:read` | — |
| `get_invoice` | read | `invoices:read` | — |
| `preview_change` | read | `subscriptions:read` | — |
| `search_knowledge` | read | `knowledge:read` | — |
| `check_policy` | read | `policy:read` | — |
| `create_ticket` | write_low | `tickets:write` | yes |
| `escalate_to_human` | write_low | `escalation:write` | — |
| `create_refund` | write_high | `payments:write` | yes |
| `cancel_subscription` | write_high | `subscriptions:write` | yes |
| `change_plan` | write_high | `subscriptions:write` | yes |

`sideEffect` drives more than naming: `write_high` is what `human_approval` mode
routes to a person, and it is what the shadow assertion refuses to let reach
execution.

The three `write_high` tools are the ones that spend the tenant's Stripe key, so
they also pass the tenant-key gate in the pipeline. `create_ticket` and
`escalate_to_human` are writes too, but they never reach Stripe.

What each verify actually checks:

| Tool | Passes only if |
|---|---|
| `create_refund` | the re-fetched refund is `succeeded` and its amount and currency match the request to the minor unit |
| `cancel_subscription` | immediate: `canceled` with a `canceledAt`. At period end: `cancelAtPeriodEnd` true, still `active`, with an effective stop date to quote |
| `change_plan` | the item now carries the target price, and any quoted proration matches within one minor unit |

`check_policy` is the one tool that can look strange. It lets the agent ask what
a rule says before proposing an action, and it writes an **advisory**
`policy_checks` row. Advisory rows gate nothing: compliance and the write
decision read only non-advisory rows. Without that flag, an agent that politely
asked about an action it never took would look like an agent that was denied.

## Facts

Policy decisions are made on facts, and facts come from records.

```
charge.created                            -> daysSinceCharge
charge.amountCaptured - amountRefunded    -> remainingRefundableMinor
proposed amount vs the above              -> exceedsRefundable
charge or subscription currency           -> currency
subscription.status                       -> subscriptionStatus
subscription.cancelAtPeriodEnd            -> cancelAtPeriodEnd
the targeted item's price                 -> currentPlanPriceId
previewChange, negative proration lines   -> prorationCreditMinor
```

`packages/tools/src/facts.ts` never reads the customer's message. If the message
says the payment was yesterday and Stripe says forty-five days ago, Stripe wins,
silently and without argument. This is the half of prompt-injection defence that
actually works; the prompt wording is the other half and the weaker one.

The only value the model contributes is the *proposed input*, and even that is
compared against record values rather than trusted. A proposed refund amount
above what the charge can still refund sets `exceedsRefundable`, and a rule
denies it.

One exception, named because it is one: `targetPlanPriceId` is taken from the
proposed input and is not checked against a Prices read. No rule consumes it and
Stripe rejects a bad price id, so it fails safe, but it is not derived from a
record the way every other fact is.

**A missing fact never behaves like zero.** A rule needing `amountMinor` when it
is absent does not match; it records the fact as missing and falls through to the
bundle default, which is `require_approval`. An absent amount satisfying
`lt: 500000` would let a high-value action through, which is how this goes wrong
elsewhere.

## Policies

Three YAML files compiled into one bundle, in this order: `refunds.yaml`,
`cancellations.yaml`, `plan-changes.yaml`. Rules are checked in file order, first
match wins, and every rule records which file and version decided.

```yaml
- id: refund_outside_window
  when:
    action: { eq: create_refund }
    daysSinceCharge: { gt: 30 }
  decision: deny
  reason: Refunds are available within 30 days of the charge
```

`refunds.yaml` leads because it also carries the rules that let reads,
escalations and tickets straight through. Order matters within it too:
`refund_exceeds_refundable` is checked before `refund_outside_window`, so a
customer asking for more than is left gets told what is left rather than told the
window has closed.

The thresholds live in the files, not in code: a 30-day refund window, an
approval threshold at INR 5,000, and an approval threshold for a proration credit
at INR 2,000.

Three decisions: `allow`, `deny`, `require_approval`. The bundle default is
`require_approval`, so a case no rule covers goes to a person rather than
through.

The engine is a pure function in `packages/core`: no I/O, no clock read, no
`await`. `evaluatedAt` is passed in rather than read, which is what makes a policy
decision reproducible in replay. Both `tools` (to gate an action) and `evaluation`
(to check compliance afterwards) call the same function, so the check and the gate
can never disagree.

A `policy_checks` row is written **every time**, including on `allow`. Missing
allow records make later auditing impossible: you cannot tell the difference
between an action that was permitted and one that was never evaluated.

## Money

Always minor units, always integers, always with a currency. `INR 3,499` is
`{ amountMinor: 349900, currency: 'INR' }`. No floats anywhere near a refund.
