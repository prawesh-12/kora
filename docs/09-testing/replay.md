# Replay

Run historical conversations through a different agent version without touching
a real business system.

```bash
pnpm kora replay --from <versionId> --against <versionId> --limit 100
pnpm kora replay --limit 100        # both default to the active version: self-replay
```

## What is reused and what is re-run

**Reused:** the customer messages in order, and the business state as it was at
the time of the original run.

**Re-run:** intent classification, retrieval, model calls, tool selection, policy
evaluation.

That split is the whole design. Anything that reads the business system is served
from what the original run recorded; anything that represents a decision is made
again by the version under test.

Which side a tool falls on is a flag on the tool definition, `rerunOnReplay`. It
defaults to false, so a new tool that reads Acme fails loudly on replay rather
than quietly comparing the new version against today's state. Only
`search_knowledge` and `check_policy` set it.

## The three things that make a replay number real

**1. Point-in-time state, everywhere it is read.** Blocking live reads inside the
pipeline is not enough. Evaluation reads the business system too, so a replayed
run gets `evaluateRun({ externalState })` built from the reconstructed state.
Without that, a run is marked wrong because some later run created a replacement
on the same order.

**2. Canonical keys.** Recorded outputs are keyed `toolName:canonicalJson(input)`.
The recorded side comes out of a `jsonb` column and Postgres does not preserve key
order there, so `JSON.stringify` on both sides silently misses.

**3. The right turn.** A conversation of three turns is three runs. The customer
message is written just before its run starts, so the turn a run answered is the
last message at or before `startedAt` — not the first one after it. Getting this
backwards compares turn one against turn three and reports a regression that is
an off-by-one.

## What is not replayable, and why that list matters

| Reason | Why it cannot be compared |
|---|---|
| no tool call in the original run succeeded | there is no state to reconstruct |
| the original run recorded no intent | nothing to compare the new classification against |
| the original run never finished | there is no outcome |
| the run hit a timeout, a 5xx or a verify failure | the recorded outputs are the successful ones; a replay sails through and reports an improvement that is really a missing fault |
| the new version called a business read the old run never made | serving it live would compare against today |

Every excluded run is printed with its reason. Silently including them is how a
replay produces confident, meaningless comparisons.

## Self-replay is the gate

Replaying a version against itself must produce an empty diff. If it does not,
something is non-deterministic and every later replay number is noise. The CLI
exits non-zero when a self-replay produces regressions, for exactly that reason.

```
No regressions.

metric              from    against  delta
verifiedResolution  11.1%   11.1%    +0.0
policyCompliance    100.0%  100.0%   +0.0
escalationRate      38.9%   38.9%    +0.0
```

## Sampling

Stratified by intent and outcome, round-robin across strata. A random sample of
production traffic is 80% order-status lookups and tells you nothing about
refunds.

## Reading the report

Regressions are printed **above** the aggregate, deliberately. A version with
+4.4 points of verified resolution and six regressions is not automatically
better, and putting the headline first is how a reviewer stops reading before the
six.

## What a replay number actually means

A replayed run executes nothing, so "verified resolution" on a replay means
**would have resolved**: policy allowed the action and the run reached the point
of execution with everything else in place. A `simulated` write counts as landed,
but only in a mode where nothing executes, and the mode is read from
`agent_runs.deployment_mode` rather than guessed from tool statuses.

That distinction is why the column exists. Without it, every replayed run scores
zero and a comparison between two versions measures the deployment mode instead
of the versions.

## Approvals are replayed, not skipped

A high-value action stops for a person. On replay there is no person, so the
driver applies the decision the original conversation recorded to the approval
the replay raises, and the next turn finds it exactly as the original did.

Two things it deliberately does not do:

- **It does not re-send the customer message to resume.** That adds a message the
  original conversation never had, and every later turn then lines up against the
  wrong one.
- **It does not invent a decision.** A tool the original conversation has no
  recorded decision for is left pending. Approving on the agent's behalf would let
  a replay claim outcomes a person never allowed.

A run that resumed after a decision, rather than answering a customer message, is
not a candidate at all: it has no message to answer. The turn that raised the
approval represents that work.
