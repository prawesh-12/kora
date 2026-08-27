# The domain

What Kora is actually reasoning about: intents, tools, facts and policies.

## Intents

Six. Classified once per turn, with a confidence threshold below which the run
hands over rather than guesses.

| Intent | What it means | Can it write? |
|---|---|---|
| `ORDER_STATUS` | where is my order | never |
| `DAMAGED_ORDER` | it arrived broken | replacement |
| `CANCEL_ORDER` | stop it before it ships | cancellation |
| `REFUND_REQUEST` | give me my money back | refund |
| `HUMAN_REQUEST` | I want a person | hands over immediately |
| `OUT_OF_SCOPE` | anything else | hands over immediately |

`READ_ONLY_INTENTS` and `HANDOVER_INTENTS` are enforced in code, not in the
prompt. `gateToolsByState` removes every write tool from what the model can even
see when the intent is `ORDER_STATUS`. A tool the model cannot see is a tool it
cannot misuse, and that removes a whole class of error without an instruction to
follow.

## Tools

Nine, each with a zod input and output schema, a permission, a timeout and a
retry class.

| Tool | Side effect | Permission | Verified by reading back |
|---|---|---|---|
| `get_order` | read | `orders:read` | — |
| `get_customer` | read | `customers:read` | — |
| `search_knowledge` | read | `knowledge:read` | — |
| `check_policy` | read | `policy:read` | — |
| `create_ticket` | write_low | `tickets:write` | yes |
| `escalate_to_human` | write_low | `escalation:write` | — |
| `create_replacement` | write_high | `orders:write` | yes |
| `create_refund` | write_high | `payments:write` | yes |
| `cancel_order` | write_high | `orders:write` | yes |

`sideEffect` drives more than naming: `write_high` is what `human_approval` mode
routes to a person, and it is what the shadow assertion refuses to let reach
execution.

`check_policy` is the one tool that can look strange. It lets the agent ask what
a rule says before proposing an action, and it writes an **advisory**
`policy_checks` row. Advisory rows gate nothing: compliance and the write
decision read only non-advisory rows. Without that flag, an agent that politely
asked about an action it never took would look like an agent that was denied.

## Facts

Policy decisions are made on facts, and facts come from records.

```
order.deliveredAt      -> daysSinceDelivery
order.totalAmountMinor -> amountMinor
refunds on the order   -> refundedAmountMinor, exceedsRemaining
order.items[].category -> category
```

`packages/tools/src/facts.ts` never reads the customer's message. If the message
says the parcel arrived yesterday and the order says twelve days ago, the order
wins, silently and without argument. This is the half of prompt-injection defence
that actually works; the prompt wording is the other half and the weaker one.

The only value the model contributes is the *proposed input*, and even that is
compared against record values rather than trusted. A proposed refund amount
above what the order can still refund sets `exceedsRemaining`, and a rule denies
it.

**A missing fact never behaves like zero.** A rule needing `amountMinor` when it
is absent does not match; it records the fact as missing and falls through to the
bundle default, which is `require_approval`. An absent amount satisfying
`lt: 500000` would let a high-value action through, which is how this goes wrong
elsewhere.

## Policies

Three YAML files compiled into one bundle: damaged orders, refunds,
cancellations. Rules are checked in file order, first match wins, and every rule
records which file and version decided.

```yaml
- id: outside_return_window
  when:
    action: { eq: create_replacement }
    daysSinceDelivery: { gt: 7 }
  decision: deny
  reason: Replacements are available within 7 days of delivery
```

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
