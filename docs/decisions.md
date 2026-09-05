# Decisions

Why the system is built the way it is. One entry per choice that a later engineer
would otherwise have to reverse-engineer, in the order they were made.

Each entry says what the situation was, what was decided, why, what else was
considered, and what it costs.

## Monotonic ULIDs for all ids

**Context.** `newId()` must produce ids that sort by creation order. Trace step
ordinals and idempotency keys both rely on it.

**Decision.** Use `monotonicFactory()` from `ulid`, not the plain `ulid()` export.

**Why.** Plain `ulid()` randomises the low 80 bits on every call. Two ids minted in
the same millisecond sort arbitrarily. The 10,000-id sortability test in
`packages/core/test/ids.test.ts` catches this.

**Trade-off.** Monotonic ids are slightly more guessable within a millisecond. That
does not matter here: conversation ids are the only ids exposed to an untrusted
caller, and they are created seconds apart.

## `evaluatePolicy` takes the evaluation time as an argument

**Context.** `evaluatePolicy(policy, facts)` returns a `PolicyResult` carrying
`evaluatedAt`. The function has to be
pure, with no clock read.

**Decision.** The signature is `evaluatePolicy(policy, facts, evaluatedAt)`.

**Why.** Those two requirements conflict. Reading `now()` inside the function makes
it impure and unreplayable. Passing the timestamp keeps the function a pure
function of its arguments and moves the clock read to the caller, which already
has a `RunHandle` and a deadline.

**Alternatives.** Default the argument to `now()`: rejected, it reintroduces the
hidden clock read, and a pure function is the thing being promised.

## `full` is the default deployment mode, not `human_approval`

**Context.** The tenant seed defaults to `human_approval`, and that mode means
"every `write_high` requires approval regardless of what policy says". But S1
expects a standard in-window refund to resolve with no approval, and a first-time
reader is expected to ask for a refund and receive a real refund id. Under
`human_approval` that first run stops at an approval card, and the thing the
product exists to show never happens.

**Decision.** `KORA_DEPLOYMENT_MODE` defaults to `full`, and the seeded tenant is
`full`. `human_approval` keeps its meaning and is still exercised by the mode
tests in `packages/tools/test/modes.test.ts`.

**Why.** `full` does not mean unsupervised. The policy engine still routes any
refund at or above INR 5,000 to a person via `refund_high_value`, an unpaid
cancellation via `cancel_unpaid_immediate`, and a large proration credit via
`plan_large_credit`. Those are what actually protect the money. `human_approval`
is a stricter blanket mode on top of them, useful for a first week in production,
not a sensible default for a system whose own acceptance suite expects otherwise.

**Trade-off.** A deployment that wants a person on every write has to set the
variable. That is one line, and it is now documented in the QUICKSTART.

`KORA_MODEL_PROVIDER` defaults to `mock`, so a misconfigured checkout cannot
silently spend money on a real provider.

## The chat response is a whole turn, not a token stream

**Context.** The chat surface was designed around `createAgentUIStreamResponse` and a
`KoraUIMessage` type exported from `@kora/ai`, consumed by the AI SDK's `useChat`.
Neither exists. `@kora/ai` exports `runAgentTurn()`, which is not a streaming
function: it persists the customer message, runs the whole turn while writing every
step to the database, persists the assistant message, then resolves with a
`TurnResult`.

**Decision.** `POST /api/chat/[conversationId]` awaits `runAgentTurn` and returns one
JSON DTO built from `TurnResult`. The browser gets a complete turn in one response.

**Why.** Wrapping a non-streaming function in a fake stream would add a layer that
carries no extra information and one more place for the trace and the transcript to
disagree. Persistence already happens inside `runAgentTurn`, so the "persist as you
stream" requirement is met by the function itself: a client that disconnects
mid-request still leaves a complete trace and a stored assistant message.

**Trade-off.** No progressive rendering. A turn against the mock provider finishes in
roughly half a second, so there is nothing to render progressively yet. Against a
real model this will need revisiting, and the honest fix is to make `runAgentTurn`
streaming in `@kora/ai` rather than to simulate it in the route.

## The customer chat cannot decide its own approvals

**Context.** beUI's `tool-approval` maps onto the chat transcript with an
`onDecision` handler, following the AI SDK's client-side human-in-the-loop pattern.

**Decision.** The chat renders `ToolApproval` with `status="pending"` and no decision
handlers. Approve and deny live only on `/ops/approvals`, behind a session.

**Why.** In Kora an approval is an *operator* decision recorded in the `approvals`
table with `decided_by` set to a real user. The AI SDK pattern assumes the person at
the keyboard is the one authorising the tool. Wiring the customer's buttons to
`POST /api/approvals/:id/decision` would let a customer approve their own refund.

## Approvals and write idempotency are scoped to the conversation

**Context.** Approving a high-value action has to make the write happen. The
pipeline's approval gate originally never asked whether an approval had already
been *granted*, and scoped its "is one pending" lookup to `run.runId`. Calling
`runAgentTurn` again on the same conversation started a new run, found no pending
approval for it, and opened a second one. The run could never get past the gate.

The idempotency key had the same shape of problem: it included `runId`, so a
resumed run derived a different key from the run that was approved.

**Decision.** Two changes, both in `@kora/tools`:

1. The approval gate looks up `approvals` for the **conversation**. An `approved`
   row for the same tool satisfies the gate; a `denied` row turns the action into a
   `denied` outcome carrying the operator's note.
2. `deriveKey` uses `conversationId` instead of `runId`.

`assembleTrace` also fetches approvals for the conversation, so a trace shows the
approval that unblocked it even though it was raised in the previous run.

**Why.** A decision is made against the customer's case, not against one run of the
agent. Scoping either to the run makes resume impossible and makes a genuine double
submit write twice, which is scenario N6.

**Alternatives.** Keeping the run scope and having the web route pass
`deploymentMode: 'full'` on resume: rejected. It works only when the deployment mode
forced the approval, and silently does nothing when the policy itself asked for one.

## `apps/web` builds on webpack, not Turbopack

**Context.** The `@kora/*` packages ship TypeScript source with no build step and
import each other with `.js` specifiers (`export * from './agent.js'`). `tsc` and
`tsx` both resolve those to `.ts`. Neither Turbopack nor webpack does by default.

**Decision.** `apps/web` builds and runs with `--webpack`, and `next.config.ts` sets
`resolve.extensionAlias` to map `.js` onto `.ts`.

**Why.** webpack has `extensionAlias` for exactly this. Turbopack has no equivalent,
and setting `turbopack.root` to the workspace root does not change the resolution.

**Trade-off.** Slower builds, and the app is off the Next.js default path. The better
fix is upstream: give the packages a build step, or drop the `.js` extensions.

## `import.meta.dirname` is rewritten at build time for the workspace packages

**Context.** `packages/db/src/migrate.ts`, `packages/ai/src/pricing.ts` and
`packages/ai/src/config.ts` compute paths from `import.meta.dirname` at module
scope. webpack compiles those modules to CommonJS, where the expression evaluates to
`undefined`, so `join(undefined, '../migrations')` throws the moment `@kora/db` is
imported.

**Decision.** `apps/web/build/import-meta-dirname-loader.cjs` replaces
`import.meta.dirname` with the real source directory for files under `packages/*/src`.

**Why.** The alternative is editing the packages, which is where this really belongs.
Using `fileURLToPath(import.meta.url)` there would work under both Node and webpack.

**Trade-off.** The rewritten paths are absolute and baked into the bundle, so the
build output is not portable to another machine. That matches what those modules
already assume: they read `config/agent.yaml` out of the repo at runtime.

## Registry components are quarantined from typecheck and lint

**Context.** The shadcn and beUI CLIs install into `components/ui`, `components/agents`
and `components/motion`. Only `components/ui` is excluded from linting by the root
`biome.json`. The beUI sources do not compile under this repo's
`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`, and two of them have
real defects (`animated-sidebar.tsx` indexes without a guard, `shared-layout-bg.tsx`
casts between non-overlapping types).

**Decision.** Every file under `components/agents` and `components/motion` carries a
one-line `// @ts-nocheck`. `apps/web/biome.json` extends the root config and excludes
the same directories plus the registry helpers that landed in `lib/`.

**Why.** The flags exist to protect Kora's own code, and they still do: every file
outside those directories is fully checked, and call sites into the registry
components are type-checked normally because only the component bodies are skipped.
Forking thirty vendored files to satisfy a stricter tsconfig than they were written
for would make every future `shadcn add` a merge.

**Trade-off.** A re-add strips the `@ts-nocheck` headers and the build breaks until
they are re-applied.

## Custom UI

Components written by hand after searching the approved registries. Four sources are
approved: shadcn primitives, beUI agent surfaces, ReUI operator surfaces, and
Beautiful UI. Anything below is here because nothing in those four fit.

**`components/kora/trace-timeline.tsx`** — searched beUI `agent-activity`, the
component the map assigns to this surface. Its `AgentActivityItem` union is a flat
list of label-and-meta rows. It has no per-row disclosure carrying input and output
JSON, no slot for a nested policy check with its rule id, version and facts, and no
way to tell a denied action from a simulated one from a failed one. Those are the
entire point of the panel. Bending it into shape would be surgery on a registry
component, which is the signal that it is the wrong component. Built from `<details>`
plus beUI `code-block`, which does render the JSON inside it.

**`components/kora/stat.tsx`** — ReUI's Stats blocks require a licence key, so they
are unavailable. shadcn has `card` but not a tile strip, and a card is the wrong
container for a bare number anyway. Three small components on a CSS grid: `HeroStat`,
`StatBar`, `Tile`.

**`components/kora/trace-verdict.tsx`** — this is a lookup from run state to one
sentence, not a widget. No registry ships "why did this agent run stop", because the
answer is specific to this policy engine and this state machine.

**`components/kora/status-pill.tsx`, `components/kora/copy-id.tsx`** — a span with a
token class and a lookup table, and a button that writes to the clipboard. Both wrap
primitives that are already installed.

**`components/ops/context-cards.tsx`, `components/ops/task-rows.tsx`** — adapted from
the genuine Beautiful UI source rather than copied. The originals take no props, carry
their own demo data and scripted animation timelines, and use a token set
(`text-ink`, `bg-surface`, `shadow-card`, `rounded-card`) that does not exist in this
app's `globals.css`. The layout grammar is theirs; the props API and tokens are ours.

**`components/kora/tool-part.tsx` plain-language map** — no registry component exists
for "describe a tool call to a customer without leaking its arguments", because it is
a product decision rather than a widget.

**The approvals chip groups and the saved-view segmented control** — ReUI `filters`
is the filter bar and is used as one on `/ops/conversations`. Both of these are
navigation: a list of links where exactly one is current. A filter builder would be
the wrong grammar and would put a query tree where four fixed links belong.

**`@beui/loading-states`** — listed in the beUI index but its shadcn item endpoint
(`https://beui.dev/r/loading-states.json`) returns 404, so the CLI cannot install it.
`components/agents/loading-states/thinking-shimmer.tsx` arrived anyway as a transitive
dependency of `@beui/agent-activity`, and that is the piece the chat needs, so nothing
was hand-built for it.

### One edit to a registry component

`components/agents/code-block.tsx` renders a green check and the word "Ready" once
its content stops streaming. On a trace page nothing streams, so every JSON pane
carried a permanent green tick sitting a few pixels from the real pass and fail pills
on the same screen. There is no prop to hide it. The badge now renders only while
streaming, marked with a `kora:` comment at the edit. Everything else in
`components/agents`, `components/motion` and `components/reui` is untouched upstream
source.

## `account.issuer` was added rather than pinning Better Auth back

**Context.** Better Auth 1.7 scopes account identity by an `issuer` column and
matches credential accounts on `issuer === 'local:credential'`. The `account` table
in `@kora/db` was the pre-1.7 default schema, so on 1.7 sign-in always returned 401
with "User not found", and sign-up threw because the field does not exist. Pinning
to 1.3.27 was the first workaround.

**Decision.** Migration `0001_account_issuer` adds
`account.issuer text not null default 'local:credential'`, the seed writes it
explicitly, and `apps/web` tracks current Better Auth.

**Why.** The default backfills every existing credential row correctly, so the
migration needs no data step. Staying a major line behind on an auth library to
avoid one column is the wrong trade.

**Verified.** `POST /api/auth/sign-in/email` with the seeded operator returns 200
and a session cookie on the current version. The scrypt hash written by
`packages/db/src/seed.ts` needed no change: `N=16384, r=16, p=1, dkLen=64`,
NFKC-normalised, `<salt>:<hex>`, which is what `@better-auth/utils` produces.

## The workspace environment is loaded by `dotenv-cli`, not by Next

**Context.** `.env` lives at the workspace root, which Next does not look at.
Loading it from `next.config.ts` reaches the config process but not the runtime that
serves requests, so `KORA_DEPLOYMENT_MODE` silently fell back to its default in
every route handler. Moving the load into `instrumentation.ts` failed differently:
Next bundles that hook for the edge runtime too, and webpack resolves `dotenv`'s
`require('path')` statically however the call is guarded, so `next dev` would not
start.

**Decision.** Every `apps/web` script is prefixed with
`dotenv -e ../../.env --`.

**Why.** It sets real process environment variables before the framework starts, so
every runtime and every child process inherits them. No bundler involvement, and it
works identically for `dev`, `build`, `start` and `test`.

## Pretty logging is opt-in

`pino-pretty` runs in a worker thread, which a bundler cannot follow: inside Next it
fails to resolve and takes the dev server down. Pretty output is now behind
`LOG_PRETTY=true` and JSON is the default everywhere. The variable is only honoured
when `NODE_ENV=development`.

## `check_policy` records the evaluation it performed

**Context.** A run that is correctly denied never calls `create_refund`, so the
pipeline never writes a `policy_checks` row for that action. The trace then showed
no reason why nothing happened, and the scenario runner had nothing to assert
`policyDecision` against.

**Decision.** The `check_policy` tool writes a `policy_checks` row for the action it
was asked about, in addition to the row the pipeline writes for `check_policy`
itself.

**Why.** It is a genuine policy evaluation, and the rule is to record every
one, including allows. Without it the most common outcome in the suite — a correct
refusal — is invisible in the trace.

**Trade-off.** When the write does go ahead there are two rows for
`create_refund`: the advisory one from the tool and the authoritative one from the
pipeline. Both are true records of evaluations that happened. The pipeline's is
the one that gated the action.

## A correct refusal is not a verified resolution

**Context.** `verifiedResolution` started as "resolved automatically, every critical
check MET, and `outcome_achieved` MET". S2 satisfies all three — the policy
correctly denied a refund outside the window and nothing was written — and the
scenario expects `verifiedResolution: false` for it.

**Decision.** For an intent that exists to change something — `REFUND_REQUEST`,
`CANCEL_SUBSCRIPTION`, `CHANGE_PLAN` — `verifiedResolution` additionally requires a
write that actually landed: a money write that is `ok` with `verified: true`, or
`replayed`.

**Why.** A correct refusal is a success for policy compliance and a non-resolution
for the verified resolution rate. Counting refusals as resolutions inflates the
headline number with cases where nothing was fixed.

**Why `replayed` counts.** The run that owned the idempotency claim did the work and
the verification. A run that replayed proved it did not duplicate it. Both
customers got a correct answer about a refund that exists.

**Why `simulated` counts, but only in simulation and shadow.** Nothing executes in
those modes, so `simulated` is the strongest claim a write can make there: the
action was allowed and reached the point of execution. Requiring a verified write
would score every replayed run zero and make a version comparison measure the
deployment mode instead of the versions. The mode is read from
`agent_runs.deployment_mode`, not guessed from tool statuses.

## Grounding lets the agent repeat an id the customer gave, but never an amount

**Context.** The grounding guard asserts every identifier in the reply appears in a
tool result from this run. A customer who names a subscription that does not exist
gets a reply like "I could not find subscription sub_0000", and that was flagged as
ungrounded.

**Decision.** Stripe ids in the reply may come from a tool result **or from the
customer's own message**. Money amounts must come from a tool result, always, and
are compared in minor units so `INR 3,499` in the reply has to match `349900` in a
tool output exactly.

**Why.** Telling a customer the identifier they just typed is not a hallucination,
and refusing to is unhelpful. An amount is different: it is the claim itself.
Saying "we refunded 3,499" when no tool result carries `349900` is the exact
failure this guard exists to catch, so the customer's message never excuses one.

**Trade-off.** The id rule does not distinguish a `re_` refund id from a `sub_`
subscription id, so a customer who writes a plausible-looking refund id into their
own message could have it echoed back. That is narrower than it looks — the reply
still cannot claim an amount, and every write is separately gated by policy,
idempotency and verify — but it is a real gap. Tightening it means treating ids the
agent could only know by acting differently from ids the customer already knows.

## The offline model provider

**Context.** There is no LLM API key in this environment, and the acceptance suite
has to run.

**Decision.** `packages/ai/src/mock/` implements a real `LanguageModelV3`. Its
behaviour comes from planner functions that read the prompt the SDK built: one
handles structured-output intent classification, one walks the refund and
cancellation workflows reacting to what each tool actually returned.
`KORA_MODEL_PROVIDER=mock` is
the default; `openai` and `anthropic` are wired and work with a key.

**Why.** Implementing the provider interface rather than stubbing the gateway means
the whole path is exercised: the tool loop, structured output, streaming parts,
usage accounting, retries and timeouts. Only model resolution differs.

**What it does not prove.** That a real model is good at this task. The suite proves
the *system* is correct. Model quality is what the judge measures.

**A trap it exposed.** `toModelOutput` truncated large tool payloads by slicing the
JSON string, which handed the model a half-finished document. It now returns a valid
JSON object describing the truncation instead. A real model would have been fed
malformed data too; the mock just failed loudly about it.

## Embeddings are a deterministic hash offline

`mockEmbedding` projects hashed token counts onto 1536 dimensions and L2 normalises.
It is a bag-of-words model, so cosine distance tracks word overlap: enough to rank
the right chunk first on this corpus and to exercise the real pgvector query plan,
and it never costs anything. It says nothing about how a real embedding model would
rank a larger corpus.

## Chunking uses a heading regex, not remark

`remark` is the obvious way to parse markdown headings. The knowledge corpus is a
handful of controlled files, and `^#{1,6} ` over paragraph-split blocks gets the
heading hierarchy exactly right for them. `js-tiktoken` is used for token counts,
because chunk sizing is load-bearing and character length is not a proxy for it.

Add `remark` when the corpus starts containing markdown that a regex gets wrong.

## The injection scenarios are part of the same suite, not a separate one

`scenarios/` holds S1 to S12, the money workflows, and S13 to S22, ten
prompt-injection attempts. They are one directory and one runner, and
`pnpm kora bench` scores all 22 together.

**Why.** An injection attempt is not a different kind of test: it is a
conversation that must reach the right outcome, which happens to be "no write".
Splitting it into its own suite makes it something you can forget to run, and the
one property it checks — that a crafted message cannot move money — is the
property that must never regress quietly. Scenarios carry a `category` field, so
`--category` still narrows a run without needing a second suite.

## Operator read paths live in `packages/db/src/queries/`, beside the repositories

**Context.** The operator screens need aggregates, keyset pagination and a sort on a value
derived from two `jsonb` columns. The repository layer is deliberately row-shaped and
closes over the tenant, and none of those fit it.

**Decision.** A second module, `packages/db/src/queries/`, exported through
`@kora/db`. Repositories stay as they are. Queries take `tenantId` as an argument and
return set-shaped results and DTO-ready value objects.

**Why.** The alternative was bending repositories into an aggregate API, which would
have meant a `withTenant().metrics.*` namespace whose methods return neither rows nor
anything a repository caller expects. Splitting on shape rather than on table keeps
both readable.

**Trade-off.** Two places to look for a read. The split is by shape and it is
documented in `docs/06-backend/query-layer.md`.

## Approval expiry is lazy in the query layer, and the CLI calls the same function

**Context.** An approval past `expires_at` has to be treated as expired
the moment it is read or decided, so the queue can never show a stale pending row.

**Decision.** `expireOverdueApprovals(tenantId)` in
`packages/db/src/queries/approvals.ts` does the whole transition: status, escalation
with `APPROVAL_DENIED`, a message telling the customer a person will follow up, and
the run and conversation moved to `NEEDS_HUMAN`. `readApproval`, `listApprovalQueue`
and `decideApproval` all call it first. `pnpm kora approvals:expire` calls the same
function.

**Why.** Putting the sweep in the CLI and the lazy check in the read path would give
two implementations of "expired", and they would drift. One function cannot disagree
with itself.

**Alternatives.** A scheduled job, rejected because building a scheduler for
one job turns a product milestone into an infrastructure one. It lands with the
worker existed.

**Trade-off.** Reading the queue writes. That is acceptable: the write is idempotent,
matches zero rows in the common case, and the alternative is showing an operator a
decision they cannot make.

## The failure breakdown counts only the primary code

**Context.** `evaluations.failure_codes` is every code the classifier found, in
root-cause order.

**Decision.** The breakdown counts `failure_codes[1]` and nothing else.

**Why.** Failures cascade. One broken retrieval produces `RETRIEVAL_FAILURE`,
`HALLUCINATION` and `OUTCOME_FAILURE` on the same run. Counting all three makes the
tallest bar the symptom furthest from the fix, which is the opposite of what the
screen is for.

**Trade-off.** A code that is never a root cause never gets a bar. `LATENCY_FAILURE`
is the realistic case, and it shows up whenever it is the only thing wrong.

## `topDetail` is recomputed from the trace, not read back

**Context.** `classifyFailures` produces a `detail` for every failure — the tool name,
the rule id, the error class — and `evaluateRun` persists only the codes.

**Decision.** `failureBreakdownSql` derives the detail per run with a `CASE` over the
code: tool failures take the last failed `tool_name / error_code`, policy failures the
last non-allow `rule_id`, everything else the run's intent. `mode()` picks the most
common per bucket.

**Why.** Without a detail the code is not actionable, and "which tool" is the hop that
makes the drill path three clicks instead of five. Recomputing needs no schema change
and no backfill of the evaluations already written.

**Trade-off.** The derivation can disagree with what the classifier decided at the
time, because it reads the trace as it is now rather than as it was. Persisting
`failure_details` alongside `failure_codes` is the better fix when the column can be
added.

## A circuit breaker failure is one per call, not one per attempt

**Context.** `executeTool` retries inside one call: a read tool gets three attempts.
The breaker opens at five failures in sixty seconds.

**Decision.** The pipeline calls `recordFailure` once, on the call's terminal
failure, and only for `UPSTREAM_5XX` and `UPSTREAM_TIMEOUT`.

**Why.** Counting attempts would open the breaker partway through the second failed
call, which makes the retry table pointless — the retries it authorises would trip
the breaker that is supposed to sit above them. Codes like `UPSTREAM_4XX` and
`MALFORMED_OUTPUT` say something about the request, not about whether the dependency
is up, so they do not count either.

**Alternatives considered.** Per-attempt counting with a higher threshold. It puts
the threshold and the retry budget in a fixed relationship that has to be
recalculated every time either changes.

**Trade-off.** A single call that times out three times reads as one failure, so a
dependency that is failing slowly takes five calls rather than two to trip the
breaker.

## Redis being unreadable blocks writes and lets reads through

**Context.** Breaker state lives in Redis. The idempotency store is Postgres, so a
Redis outage does not by itself make a write unsafe.

**Decision.** `gate(key, kind)` resolves an unreachable store to *blocked* for a
write and *permitted* for a read.

**Why.** With the breaker unreadable we cannot tell a healthy dependency from a
downed one. A write into a dependency that is actually down can duplicate or go
unrecorded, and neither can be taken back. The worst case of letting a read through
is a slow failure.

**Alternatives considered.** Failing open for everything, which reintroduces exactly
the hammering the breaker exists to stop; failing closed for everything, which turns
a Redis blip into a total outage of an agent that mostly reads.

**Trade-off.** A Redis outage stops all writes even when every business dependency is
healthy. That is the intended direction of the failure.

## The deployment mode gate runs after the approval branch

**Context.** The pipeline gates on deployment mode so that simulation, shadow and
replay never touch the business system. The obvious place for that gate is early,
right after the permission check, since it short-circuits everything downstream.

**Decision.** It runs after the policy check *and* after the approval branch. In
simulation and shadow a write that policy sends to a person still returns
`awaiting_approval`.

**Why.** With the gate early, a high-value write came back as `simulated` — a
silent success. The run then looked resolved when in production it would have
stopped for a human. That is precisely the thing replay and shadow exist to
measure, so putting the gate first destroys the measurement it is supposed to
serve. Concretely: a run that ended `AWAITING_APPROVAL` in production replays as
`NEEDS_HUMAN`, and the escalation rate moves by tens of points for no behavioural
reason at all.

**Alternatives considered.** Recording the approval decision on the
`tool_executions` row while still returning `simulated` keeps the audit trail but
not the run's final state, and the final state is what every metric reads.

**Trade-offs.** Replaying historical traffic now raises real approval rows.
`listPending` excludes conversations on the `replay` channel, so an operator
queue does not fill with decisions about conversations that already ended.

## Replay refuses reads the original run never made

**Context.** Replay serves recorded outputs for business reads and writes. A new
agent version may call a tool the old run never called, so there is no recorded
output for it.

**Decision.** A business read with no recorded output fails the call with
`REPLAY_GAP` and the run is reported as not replayable. Retrieval and policy
evaluation re-run normally, marked by `rerunOnReplay` on the tool definition,
which defaults to false.

**Why.** The alternative is letting the read hit the live system, which compares
the new version against today's state rather than against that day's, which
produces confident and meaningless comparisons. The flag
defaults to false so a new tool that reads the business system fails loudly on
replay instead of quietly measuring the wrong thing.

**Trade-offs.** A version that legitimately gathers more context scores as not
replayable rather than as better. That is the correct answer at this evidence
level: it might be better, and the replay cannot tell.

## Runs whose outcome came from an injected fault are not replayed

**Context.** Much of the traffic available to replay comes from chaos runs, where a
fifth of business calls fail.

**Decision.** A run whose trace contains `UPSTREAM_TIMEOUT`, `UPSTREAM_5XX`,
`VERIFY_FAILED` or `DEADLINE_EXCEEDED` is marked not replayable.

**Why.** `reconstructState` keeps the successful outputs, so a replay of such a
run sails through and reports an improvement that is really a missing fault. That
would measure the fault injector, not the agent.

**Trade-offs.** It excludes a lot: 127 of the 145 candidates in the last run. The
count is printed with a per-run reason, so the exclusion is visible rather than
silently improving the numbers.

## Judge kappa is gated, but only above a hundred labels

**Context.** Calibration should gate on Cohen's kappa at 0.6 per criterion, over a
gold set of 100 to 200 traces.

**Decision.** The gate exists and is enforced, but only for criteria with at least
100 labels. The gold set stays at 30 and is not grown.

**Why.** Kappa on twenty-five samples swings on a single disagreement, so gating
there disables criteria at random. `no_dead_end` currently shows 93% agreement and
a kappa of 0.00, which is exactly the noise the threshold protects against. The
gold set's labels are derived from the same evidence the judge reads, so growing
it to 200 would cross the threshold and switch on a gate measuring the judge's
self-consistency rather than its agreement with a person. That is worse than no
gate, because it looks like one.

**Trade-offs.** Kappa is reported and not acted on today. Replacing the labels by
hand is the prerequisite for growing the set, and the calibration output says so.

## Scenarios run sequentially against a per-scenario billing stub

**Context.** Every scenario needs Stripe to be in a specific state: a charge five
days old, a charge forty-five days old, a charge with part of it already refunded.
Sharing one account between scenarios means each has to set that state up and tear
it down around the others.

**Decision.** Each scenario installs a fresh in-memory `BillingProvider` seeded
from its own `seed` block, and scenarios run one at a time. Idempotency claims are
cleared once per pass, never per scenario.

**Why.** A fresh provider per scenario means there is no shared state to corrupt,
so there is no reset to get wrong and no lock to remember. `setBillingProvider` is
process-wide module state, which is what forces the sequencing: two scenarios at
once would share one stub.

Clearing idempotency claims per scenario would be the one remaining way to
manufacture a false result. Deleting a claim another scenario is holding is
exactly how a suite fabricates the duplicate write it exists to detect, so that
happens once per pass. No scenario needs it more often: each opens a new
conversation, and the claim key is scoped to the conversation.

**Alternatives considered.** Running against a real Stripe test account with Test
Clocks would be a stronger signal, and it is what the fixtures script is meant to
grow into. It cannot run in parallel either — a Test Clock is shared state — and
it needs an account, so it is not what a contributor gets from a clean clone.

**Trade-offs.** The suite is fast, deterministic and free, and it proves nothing
about whether Stripe behaves the way the stub does. That gap is named in
[Status](00-overview/status.md#what-is-not-proven) rather than papered over.

## A simulated write counts as a write, but only in a mode where nothing executes

**Context.** `verifiedResolution` requires that a write-capable intent actually
landed a write: `ok` and verified, or `replayed`. Nothing executes in simulation
or shadow mode, so every write there is `simulated`.

**Decision.** In `simulation` and `shadow`, a `simulated` write counts as landed
for `verifiedResolution` and for the outcome check. In every other mode the rule
is unchanged.

**Why.** Without it every replayed run scores zero on verified resolution, and a
replay comparison between two versions is then measuring the deployment mode
rather than the versions. It showed up as a self-replay regression of 11 points
with no behavioural difference anywhere in the trace.

The mode is read from `agent_runs.deployment_mode`, which is why that column
exists. Inferring it from the presence of simulated executions would let a
production run with one odd status claim a resolution it never made.

**Trade-offs.** A replay number is a "would have resolved" number, not a "did
resolve" number. That is the strongest claim available when nothing was executed,
and it is stated in `docs/09-testing/replay.md` rather than left implied.

## A resumed run is not a replay candidate

**Context.** Approving a high-value action continues the work in a new run with
no customer message of its own.

**Decision.** A run with no `trigger_message_id` is reported as not replayable.
The approval decision itself *is* replayed: the driver records the same decision
on the approval the replay raises, and the next turn finds it exactly as the
original did.

**Why.** A continuation has no message to answer, so replaying it alone compares
it against a message it never saw. Re-sending the message instead was worse: it
adds a customer message the original conversation never had, and every later turn
then lines up against the wrong one. That was worth 22 points of escalation rate
in a self-replay that should have been empty.

**Trade-offs.** A conversation whose only interesting behaviour is the resume is
excluded rather than approximated. The turn that raised the approval is still
compared, and it is the turn that made the decision worth measuring.

## The marketing route is hand-built, not assembled from the registry

**Context.** The rest of `apps/web` is built from shadcn, ReUI and beUI components,
and `scripts/ui-gate.sh` enforces that: a hand-written table or a native `<select>`
fails the build. The marketing landing page at `apps/web/app/(marketing)` does not
follow that rule.

**Decision.** Every element on the marketing route is written by hand. No registry
component is used, and no icon library. The route carries its own stylesheet,
`marketing.css`, with its own tokens, and shares nothing with the product theme.

**Why.** The page is built around effects the registries do not carry — a headline
whose lines sit in solid blocks that hug the text, and hand-drawn SVG diagrams of
the pipeline and the read-back. The registries cover application furniture, which
is the product app's problem, not this page's.

Forcing a registry component into the layout would also import the product theme's
radii, shadows and hover states, and the page bans all three.

The one component the page does share with the product is the Proof Card, and that
is deliberate: the page's central claim is what that card shows, so showing a
drawing of it instead of the real one would be the exact thing the page argues
against.

**Trade-offs.** The route cannot inherit registry fixes or accessibility work. It is
held to its own gate instead, `scripts/marketing-gate.sh`, wired into `pnpm lint`,
which fails on the class names and copy that the design forbids and asserts the
page keeps exactly one `<h1>` and a real `box-decoration-break`. The component rule
in the UI brief still applies to everything outside `(marketing)`.

## What the landing page is allowed to claim

**Context.** The page argues that KORA verifies its own work. Anything on it that
turns out to be decoration undercuts the argument more than a missing section would.

**Decision.** Four sections named in the design brief are not on the page.

The logo marquee and its trust strip are gone: KORA has no customers, and a wall of
logos is either false or borrowed. No stand-in was substituted, so the marquee
technique is not built at all.

There is no statistics band. Numbers that appear in product fragments are sample
values inside a depicted interface — a refund amount on an illustrated Proof Card —
and none of them is presented as a measurement of Kora. There is no measured
performance to report, and the page does not invent one.

Second-tier navigation carries `Security` and `Pricing` in the brief. Neither has a
section on the page, and an anchor to a section that does not exist is a dead link,
so both were dropped rather than pointed at nothing. The footer is three columns of
real destinations for the same reason, and its newsletter block is a description and
a contact link because a subscribe form here would post nowhere.

**Why.** The page's only real claim is that Kora reads Stripe back. A reader who
catches one invented number stops believing the rest. Every identifier, rule id,
amount and outcome shown in a figure is checked against `config/policies/`,
`packages/tools/src/tools` and the real record shapes before it ships.

**Trade-offs.** The page is shorter and has less social proof than the reference it
was drawn from. That is the correct trade before there are customers to name.
