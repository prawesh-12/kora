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
"every `write_high` requires
approval regardless of what policy says". But scenario H1 expects order 9832 to
resolve with no approval, and a first-time reader is expected to send
the 9832 message and receive a real replacement id. Under `human_approval` that
demo stops at an approval card and MVP condition 1 cannot be met.

**Decision.** `KORA_DEPLOYMENT_MODE` defaults to `full`, and the seeded tenant is
`full`. `human_approval` keeps its meaning and is still exercised
by scenario H2.

**Why.** `full` does not mean unsupervised. The policy engine still routes anything
at or above INR 5,000 to a person via `high_value_needs_approval`, which is what
actually protects the money. `human_approval` is a stricter blanket mode on top of
that, useful for a first week in production, not a sensible default for a system
whose own acceptance suite expects otherwise.

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

**Decision.** Every `apps/web` and `services/mock-commerce` script is prefixed with
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

**Context.** A run that is correctly denied never calls `create_replacement`, so the
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
`create_replacement`: the advisory one from the tool and the authoritative one from
the pipeline. Both are true records of evaluations that happened. The pipeline's is
the one that gated the action.

## A correct refusal is not a verified resolution

**Context.** `verifiedResolution` started as "resolved automatically, every critical
check MET, and `outcome_achieved` MET". Scenario N2 satisfies all three — the policy
correctly denied an out-of-window replacement and nothing was written — and the
expects `verifiedResolution: false` for it.

**Decision.** For a `DAMAGED_ORDER` run, `verifiedResolution` additionally requires a
write that actually landed: a `create_replacement` execution that is `ok` with
`verified: true`, or `replayed`.

**Why.** A correct refusal is a success for policy
compliance and a non-resolution for VRR. Do not conflate them." Counting refusals as
resolutions inflates the headline number with cases where nothing was fixed.

**Why `replayed` counts.** The run that owned the idempotency claim did the work and
the verification. A run that replayed proved it did not duplicate it. Both customers
got a correct answer about a replacement that exists.

## Grounding lets the agent repeat an order number the customer gave

**Context.** The grounding guard asserts every identifier in the reply appears in a
tool result from this run. Scenario N1 asks about order 9999, which does not exist,
so `get_order` returns nothing and the reply "I could not look up order 9999" was
flagged as ungrounded.

**Decision.** Order ids and money amounts may come from a tool result **or from the
customer's own message**. Replacement ids must come from a tool result, always.

**Why.** Telling a customer the number they just typed is not a hallucination, and
refusing to is unhelpful. Repeating a `REP-` id the customer supplied is different:
it would claim an action happened. That asymmetry is the rule.

## The offline model provider

**Context.** There is no LLM API key in this environment, and the acceptance suite
has to run.

**Decision.** `packages/ai/src/mock/` implements a real `LanguageModelV3`. Its
behaviour comes from planner functions that read the prompt the SDK built: one
handles structured-output intent classification, one walks the damaged-order
workflow reacting to what each tool actually returned. `KORA_MODEL_PROVIDER=mock` is
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

## Twelve scenarios, not eleven

The suite was specified as "eleven scenarios" and then enumerated as H1, H2 and
N1 through N10,
which is twelve. `scenarios/` has twelve files and the suite runs all of them.

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

## A benchmark scenario resets only what a lock protects

**Context.** 120 scenarios run five at a time against one Acme dataset. Each
scenario resets its fixture before running.

**Decision.** A full reset happens once per pass and nowhere else. A scenario
resets only the orders it seeds. A scenario with no seeded order resets nothing.
Idempotency keys are cleared once per pass, never per scenario.

**Why.** Each rule closes a way for one scenario to corrupt another, and every one
of them produces a failure that reads as a product regression rather than a
harness problem: the scenario fails in a full run and passes in isolation.

- Scenarios sharing an order race each other. The per-order lock serialises them.
- A scenario with no order holds no order's chain, so the lock cannot protect
  anything from it. If it resets everything, it wipes the fixture out from under
  whatever is running alongside.
- Clearing every idempotency key mid-pass can delete a claim another scenario is
  holding, which is how a benchmark manufactures the duplicate write it exists to
  detect.

**Alternatives considered.** Running scenarios sequentially removes all of it and
takes far longer, which in practice means the benchmark stops being run. Giving
each scenario its own dataset means the mock service grows a tenancy model to
serve a test harness.

**Trade-offs.** The rule has to be remembered when a scenario is added: anything
that resets shared state must run while nothing else does, or be scoped to
something a lock protects. It is written at both reset sites and in
`docs/09-testing/README.md`.

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

**Why.** The three effects the page is built around are a headline whose lines sit
in solid blocks that hug the text, full-bleed bands cut on a diagonal, and a
halftone dot grid. None of these exists in shadcn, ReUI, beUI or Beautiful UI. They
were searched for by name and by shape: highlight headline, marked text, mark
element, diagonal section, angled divider, clip-path band, skew section, dot grid,
halftone, marquee, offset card. The registries cover application furniture, which
is the product app's problem, not this page's.

Forcing a registry component into the layout would also import the product theme's
radii, shadows and hover states, and the page specification bans all three.

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
values inside a depicted interface, the same kind of thing as `REP-2931`, and none
of them is presented as a measurement of KORA.

Second-tier navigation carries `Security` and `Pricing` in the brief. Neither has a
section on the page, and an anchor to a section that does not exist is a dead link,
so both were dropped rather than pointed at nothing. The footer is three columns of
real destinations for the same reason, and its newsletter block is a description and
a contact link because a subscribe form here would post nowhere.

**Why.** The page's only real claim is that KORA reads the business system back. A
reader who catches one invented number stops believing the rest.

**Trade-offs.** The page is shorter and has less social proof than the reference it
was drawn from. That is the correct trade before there are customers to name.

## The evaluator runs nine checks, so the page says nine

**Context.** The brief describes the Evaluate pillar as seven deterministic checks
and asks for a seven-row illustration.

**Decision.** The page says nine and lists all nine by their real identifiers, in
the order `CHECKS` declares them in `packages/evaluation/src/checks/index.ts`.

**Why.** There are nine. On a page whose subject is not overstating what happened,
shipping a count that disagrees with the code is the one mistake that costs the most.

**Trade-offs.** The illustration is two rows taller than the brief's composition.

## The trace figure is rebuilt in HTML, not captured

**Context.** The product band is specified as a screenshot of the trace screen,
because that screen carries the argument: the verdict, the rule that produced it,
and the read-back.

**Decision.** The figure is HTML and CSS, not an image. It shows the verdict banner
first, the policy check nested inside the `create_replacement` card it applies to,
and the read-back row that closed the run.

**Why.** The shipped trace screen does not present it in that order yet. A capture
taken today would show the verdict in a third column and durations that read `0ms`,
which argues against the page rather than for it.

**TODO.** Replace this with a real 2x capture once the trace screen redesign lands.
The figure lives in `apps/web/app/(marketing)/components/trace.tsx` and swapping it
for a `next/image` is a single-component change.

**Trade-offs.** It is a drawing of the product, so it can drift from the product. The
TODO above is the guard, and the check identifiers and route paths it shows are read
from the real ones.

## Two palette values moved to clear WCAG AA

**Context.** The page has to score 100 on accessibility, and the palette was fixed
by the brief.

**Decision.** `--ink-muted` moved from `#6e6e73` to `#6a6a6f`. Text on `--signal`
and on `--rust` is `--ink`, not white.

**Why.** `#6e6e73` on `--paper-warm` measures 4.41:1, under the 4.5:1 floor, and it
is the colour of the whole second navigation tier and every footer heading. The new
value clears 4.5 on warm, cream and white and is four steps darker, which is not a
visible change. White on `--signal` measures 2.87:1 and white on `--rust` 3.39:1;
both are well under. `--ink` on the same grounds measures 6.81:1 and 5.76:1, so the
fix needed no new colour. The palette still has exactly the eleven values it had.

**Trade-offs.** The read-back bar reads as dark text on green rather than white on
green. `--signal` still means verified, which was the rule that mattered.

## The nav and the accordion ship without JavaScript

**Context.** The brief expects the accordion and the collapsing navigation to be
client components.

**Decision.** Both are CSS and HTML. The accordion is `<details name="how-it-works">`,
whose exclusive behaviour and keyboard handling are native. The second navigation
tier collapses on a scroll-driven animation timeline. The only client component on
the route is the section reveal.

**Why.** It keeps everything above the fold server-rendered, which is what the LCP
requirement is really asking for, and it is less code than either would have been.

**Trade-offs.** Where `animation-timeline` is unsupported the second tier stays
visible, and where `::details-content` is unsupported the accordion opens instantly.
Both degrade to a working page rather than a broken one.

The reveal is an observer rather than a `view()` timeline because a view timeline
runs backwards when you scroll up, and the brief asks for the fade to happen once.
It leaves anything already on screen exactly as the server rendered it.

## What the landing page had to stop claiming

**Context.** The page argues that KORA checks its own work against the business
system. A claim on it that does not survive the same check is the one thing that
cannot be there. A pass over the page against `packages/`, `config/`,
`services/` and `apps/web/app/api/` found several.

**Removed, and why.**

*A `/v1/` API.* The page showed four `/v1/` routes. No such prefix exists. The
real routes are under `/api`, and one of the four, `/v1/conversations/{id}/messages`,
had no counterpart at all: messages are posted to `/api/chat/{conversationId}`.
All four rows now name routes that exist, with the methods their handlers export.

*An MCP server.* The page opened with an `mcpServers` configuration block. There
is no MCP server anywhere in this repository. The block is gone, and the code
panel shows a trimmed response from `GET /api/conversations/{id}/trace` instead,
with the field names and enum values that endpoint really returns.

*A two-minute trace video.* There is no video. The button reads "See a real
trace" and moves to the trace figure further down the page, which is a thing
that exists.

*`Docs` and `Company` in the top navigation.* Neither had a destination. The top
tier now lists three routes in the app and nothing else, and `Evaluation` appears
there rather than in both tiers.

*A policy decision that the policy engine would not make.* The trace figure
showed `amountMinor 349900` being held by `high_value_needs_approval`. That rule
fires at `gte: 500000`, so the real engine would have matched `standard_replacement`
and allowed it. The figure now runs on seeded order 9833 at `899900`, which is a
case that rule genuinely holds.

*Invented identifiers.* `ORD-8841` is not an order id format; seeded orders are
bare numbers like `9832`. `REP-2931` is not a replacement id; they are
`REP-` and four padded digits. `classify_intent` and `reply_to_customer` are not
registered tools; the step kinds are `RunStepKind` values and the tools are the
ones in `packages/tools/src/tools`. `within_window` and `under_threshold` are not
rules in the policy file. All replaced with the real ones.

*A replay comparison that did not match the report.* The Improve panel had `v3`,
`v4` columns and metric names of its own. `ReplayReport.aggregate` is keyed
`verifiedResolution`, `policyCompliance`, `escalationRate`, `meanLatencyMs` and
`meanCostUsdMicros`, and `renderReplay` prints `metric`, `from`, `against`,
`delta`, with regressions above the table so a reviewer cannot read the headline
and stop. The panel now does the same.

**Kept, because it checked out.** Nine deterministic checks: `CHECKS` declares
exactly nine, and the page lists all nine by their real ids. Replay itself is
built, so the Improve pillar stays.

**Trade-offs.** The page now depends on details of the code and will need
revisiting when they move. That is the right direction for the dependency to
run on a page about verification.

## Layout corrections the transcription introduced

**Context.** Several measurements were carried over from the reference design
without checking what they do in this page's own grid.

**Decision and why.**

The trace figure was lifted 120px into the section above it, which put it
through the hero's own call to action. The lift is 48px, which is what it takes
for the button to clear it. The figure was also 1180px in a 1376px container, so
the band it sits on read as a stripe down one side rather than a backdrop; it is
1100px now and the plum shows properly to its right.

The highlight blocks used 0.06em of vertical padding. At `line-height: 0.98` the
inline box is shorter than the glyphs, so capitals broke the top edge of the
block. 0.14em clears the ascenders at 72px, 56px and 42px.

The two-by-two grid asked for cells of 382px inside a column that is 52% of the
container. At 1440 that is 764px of cells in 716px of column, which is what
collapsed the grid into three ragged columns. The cells size to the column and
hold their square with `aspect-ratio`.

Sections padded both top and bottom, so every boundary between two of them was
240px. Padding is a leading rule now, applied to the top only, with the last
section closing the run. The one caveat is that each section is wrapped for its
reveal, which makes every one of them `:last-of-type`; the closing rule is named
rather than positional for that reason.

The rust slab behind the final card was inset from the card, which pushed it off
the left of the viewport and put two pixels of horizontal scroll on the page at
768. The slab sits on the container edge and the card is inset from it, which is
also the only arrangement where the peek is visible on both sides.

## The root layout stops preloading a font the landing page never uses

**Context.** The marketing route scored 93 on Lighthouse performance against a
95 floor, entirely on a 3.2s largest contentful paint. First paint was 1.1s, so
the gap was fonts, not code.

**Decision.** `Inter` in `apps/web/app/layout.tsx` is loaded with
`preload: false`.

**Why.** The root layout puts three font families on every route in the
application: Inter and JetBrains Mono from itself, and Inter Tight from the
marketing layout below it. `next/font` preloads a family on every route where
its loader runs, and the root layout runs everywhere, so the landing page was
preloading roughly 130KB of fonts across three files. It never uses Inter at
all: its display face is Inter Tight and its mono is JetBrains Mono.

Dropping that one preload takes performance to 97 and LCP to 2.4s. The landing
page now fetches two font files rather than three, and Inter is not among them.

**Trade-offs.** Product routes still declare, load and apply Inter, but they
fetch it when the stylesheet is parsed rather than from a link in the head. They
already set `display: swap`, so text paints immediately in the fallback either
way; the swap lands slightly later than it did. That was measured on `/login`,
where the body font still resolves to Inter and the file still loads.

The larger fix is per-route fonts: move Inter and JetBrains Mono out of the root
layout into the routes that use them, and let the marketing layout declare its
own two. That removes the trade-off entirely and is worth doing when the product
routes next get attention. It was not done here because it touches three layouts
outside the marketing route for a gain the single-line change already delivers.

## The product shots are looping HTML, not video

**Context.** The landing page needed a moving proof shot of a trace, and the
console tour needed four. The obvious answer is a screen recording.

**Decision.** Both are timed reveals of the HTML fragments the pages already
have. `apps/web/components/marketing/Sequence.tsx` runs them.

**Why.** A capture of the operator console today would ship the interface that
is still being fixed. Beyond that, a video file would be the only raster asset
on a page whose whole visual system is flat HTML: it is sharp at exactly one
size, it costs largest-contentful-paint budget, and it goes stale the moment a
label changes. A sequence built from the fragments cannot drift from them.

**How it works.** Every beat is a CSS animation with its own `animation-delay`,
set from an inline `--at` custom property. `Sequence` owns one timer per cycle
and nothing else: no per-frame state, no work on the main thread while it plays.
The reset is a hard cut, because dropping a class, forcing a reflow and putting
it back returns every element to its first frame together.

That design is also what keeps the fragments server-rendered. Driving beats from
React state was tried first and measured: it turns every fragment into a client
component and puts their hydration in front of the hero's paint, worth 0.4s of
LCP on the landing page.

The resting state is empty rather than composed. Composed means the server's
first paint shows the ending, a green RESOLVED banner over a timeline that has
not run yet, which gives the sequence away before it starts. The cost is that
with JavaScript disabled the figures stay empty; the surrounding prose and the
caption still carry the argument, and showing the ending first is worse.

**Trade-offs.** No controls. There is no play, pause, replay or progress bar, so
the whole surface is the recording and there is nothing to mistake for product
chrome. The loop pauses when it leaves the viewport and restarts from the top on
return, so no timer ever runs off-screen.

## The hero headline blocks were cutting their own glyphs

**Context.** The reported fault was that capitals in line one were clipped by
the top of the highlight block, and the fix applied twice was more vertical
padding.

**Decision.** Each line of the headline is a block of its own, separated by the
difference between the block height and the line advance.

**Why.** The padding was not the problem, and adding more made it worse. A
highlight block is as tall as the font's own box plus its padding, about 1.49em
at 72px. The line advance at `line-height: 0.98` is 0.98em. Two lines in one
flow put the second block 0.98em below the first while the first is 1.49em
tall, so the second painted over the bottom third of the first and cut the
letters through the middle. Measuring the line box said everything was fine,
which is why it was reported fixed twice; the glyph ink told a different story.

The gap is derived from the type, not typed in: block height minus advance. The
`<h1>` still computes to 72px on a line-height of 0.98.

**Trade-offs.** The headline is two block elements rather than a `<br>`, which
is what makes the badge positionable against line one rather than the whole
heading.

## The band no longer lifts into the hero

**Context.** The trace figure sat on a negative offset so it overlapped the
white section above it, and the overlap kept landing the verdict banner on the
hero's call to action.

**Decision.** The band starts below the hero. No lift.

**Why.** Two attempts to keep a safe overlap both measured clear at the widths
tested and were still covering the button in practice. The overlap is
decorative and the button is not. Clearance is now 184px at every width from
375 to 1920, at every scroll position where both are on screen.

## Numbers on the console tour are seeded, not measured

**Context.** The four console scenes show rates and counts.

**Decision.** Every identifier is the code's own: failure codes from
`FAILURE_CODES`, their colour from `FAILURE_SEVERITY`, metric names from the
`Metrics` interface, `get_order / upstream_4xx` exactly as
`packages/db/src/queries/metrics.ts` builds it, and tools from the registry. The
counts and rates behind them are figures from a seeded development database.

**Why.** They are sample values inside a depicted interface, the same kind of
thing as `REP-0001`, and none is presented as a measurement of how KORA
performs. The run durations in particular read as tens of milliseconds because
the seed runs against a mock agent, not a model.

**Trade-offs.** A reader could take 30.4% as a claim. It is captioned as a
console, not as a result, and no number from these scenes appears as a headline
statistic anywhere on either page.

Severity maps onto the existing palette rather than adding a colour: critical is
`--rust`, normal is `--ink`, low is `--ink-muted`. Green still means verified and
amber still means held for a person.

## The root layout preloads neither product font

**Context.** The landing page has to score 95 on Lighthouse performance with the
hero headline as its largest contentful paint. Sitting at 94 to 97 across runs,
it straddled the threshold.

**Decision.** `Inter` and `JetBrains_Mono` in `apps/web/app/layout.tsx` are both
loaded with `preload: false`.

**Why.** The root layout puts three font families on every route: those two, plus
Inter Tight from the marketing layout below it. `next/font` preloads a family on
every route its loader runs on, and the root layout runs everywhere, so the
landing page was preloading around 130KB across three files before painting a
headline that needs one of them.

It never uses Inter at all; its display face is Inter Tight. Nothing on any route
is set in mono above the fold either: JetBrains Mono carries ids, codes and JSON
further down the page. Both were competing with Inter Tight for the window that
decides the paint.

With neither preloaded the landing page holds 97 across runs and the console
tour 96, and the landing page fetches two font files rather than three.

**Trade-offs.** Product routes still declare, load and apply both faces; they
fetch them when the stylesheet is parsed rather than from a link in the head.
Both set `display: swap`, so text paints immediately in the fallback either way
and the swap lands slightly later. Measured on `/login`, where the body font
still resolves to Inter and the file still loads.

The larger fix is per-route fonts: move both out of the root layout into the
routes that use them, and let the marketing layout declare its own. That removes
the trade-off and is worth doing when the product routes next get attention.

## The hero and the trace band are each one screen

**Context.** The landing page opened with a short hero and the plum band already
creeping into the first viewport, so neither read as a whole thing.

**Decision.** The hero is `calc(100dvh - 124px)`, the height of the viewport less
the two navigation tiers, which are sticky but still in flow. The band that
carries the trace is `100dvh`. The space the taller hero opens up is filled by a
row of three claims along its floor, each naming something the run below it
actually records: the policy file and version, the gates a write passes, and the
check that has to be MET before the run counts as resolved.

**Why.** The band arriving halfway up the first screen made the trace look like a
footnote to the headline rather than the proof of it. Giving each its own screen
lets the headline make the claim and the band demonstrate it.

**Trade-offs.** Below 768 the hero drops back to its content height. A phone
viewport minus 124px of navigation is not enough room for a 42px headline, a
lead, a button and three claims without setting everything too small to read.

The slack above the headline is fixed padding rather than an auto margin. Auto
margins were tried and cost three points of Lighthouse performance: they make the
heading's position depend on layout that settles when the font loads, so the
element moves and its largest contentful paint is recorded again, later. Median
LCP went from 2.57s to 2.96s across five runs each. The composition is balanced
by choosing the padding instead.

## The trace loop runs at 4.6s

**Context.** The sequence ran a 7s cycle, which is a long time to watch a figure
repeat itself on a page someone is scrolling past.

**Decision.** 4.6s, with every beat tightened and the amber hold kept at 1.0s.

**Why.** The hold is the argument: everything before it is the agent proposing,
everything after is a person deciding. Compressing it would save a third of a
second and lose the point of the sequence. The rest had slack in it.

## The system map is hero furniture, cut to a quarter

**Context.** The map first shipped as its own full-bleed section mid-page,
carrying thirteen pipeline stages, four input tiles, three decide nodes and a
four-metric Prove column.

**Decision.** It lives in the hero's right column as an `--ink` panel, radius 4,
no band padding and no heading of its own. The body paragraph and the call to
action moved under the headline in the left column. The panel shows four columns
of at most three items: message and order; intent and the rule engine; policy
check, execute and verify; the check count and the outcome.

**Why.** Mid-page it was a second argument competing with the trace band. In the
hero it is the argument, next to the sentence that makes it. And at 494px wide
it cannot carry a wall of thirteen rows: the full gate stays in the Act pillar
further down, where there is room for it.

**What moved and why.** Three things could not fit at panel scale and are not
gone, only relocated.

The policy identity is on the mono line under the tabs rather than inside the
rule engine node. `acme_damaged_order` is eighteen characters; the node is 106
units wide, which puts it under six pixels rendered. The line under the tabs is
the full width of the panel and reads at twelve.

That line also replaces the SVG's `<title>`. A `<title>` is what a browser
renders as a hover tooltip, and at this size the tooltip covered the Act column.
The line names the scenario, the policy and the decision, and changes with the
tab.

The per-scenario asserted-check count went with it. The panel says `9 checks`,
which is the length of `CHECKS` and true of every run; which subset a scenario
asserts is detail for a page with room for it.

**The four column captions are gone.** They were the old accordion's bodies, and
there is no room for four paragraphs beside a 560px panel. The same material is
in the four pillars further down, which is where a reader who wants it will be.

**Restructures at 1280, not 1024.** The brief says below 1024 the map moves under
the call to action. At 1025 the hero's right column is 384px, which would put the
diagram's labels near six pixels, so it stacks at the same step the type scale
already uses. Restructured, not shrunk.

**A stale copy of the old band CSS was overriding the panel.** Worth recording
because it cost an hour: moving the map into the hero left the full-bleed version
of its stylesheet in the file, 383 lines further down, where source order made it
win. The symptom was font sizes that would not change no matter what was edited.

## The system map replaces the accordion and the colour grid

**Context.** "How it works" was an accordion of four steps beside a two-by-two
grid of coloured panels. Both described the same run, and neither showed it as
one thing.

**Decision.** A single diagram on a full-bleed `--ink` band: inputs, the rule
engine, the gate, the checks, and the return path back to the rule engine. The
accordion's four bodies became the map's column captions. The eyebrow and the
headline stayed.

**Why.** The argument is that one run passes through one gate and comes back
measurable. An accordion hides three quarters of that behind a click, and a grid
of four coloured squares asserts it without showing it.

**What the map is allowed to say.** Everything on it is read out of the
repository:

The thirteen stages in the Act column are the numbered steps of `runTool` in
`packages/tools/src/pipeline.ts`, in the order it runs them: resolve version,
validate input, permission check, policy check, limited-mode caps, approval
gate, deployment mode gate, circuit breaker, idempotency claim, execute,
validate output, verify, settle idempotency. The brief guessed seven.

The four tabs are four files in `scenarios/`, by id: H1
`damaged_order_within_policy`, H2 `damaged_order_above_approval_threshold`, N2
`return_window_expired`, N7 `verification_failure`. Each tab's policy decision,
outcome and asserted checks come from that file's `expect` block.

The Prove column reports `9 run`, the length of `CHECKS`, against the number of
checks the open scenario actually asserts. No rate, no percentage: the page has
no measured performance to report and does not invent one.

The return path claims `replay · promote` because `replay()` in
`packages/evaluation/src/bench/replay-driver.ts`, `pnpm kora replay`,
`pnpm kora agent:promote` and `pnpm kora agent:rollback` all exist, along with
`POST /api/agent-versions/rollback`. The worker's `replay-pending-events` job is
not part of this loop: it is an outbox catch-up for events whose enqueue failed,
so it is not claimed here.

**Two departures from the brief.**

There is no `--danger` in the palette, and none was added. Failure is `--rust`,
the colour "6 regressions" already uses.

`Denied by policy` is not drawn as a failure. The brief assigns it the danger
colour, but N2's own expectation is `state: RESOLVED` with `policy_compliance`
and `outcome_achieved` both MET: the rule engine said no and the agent told the
customer why, which is the system working. It takes the neutral stroke, and
`write_verified` reads `—` rather than a value, because no write was proposed.
Colouring a correct refusal red would be the same mistake the page is arguing
against.

**Restructures at 1280, not 1024.** Below 1280 the four columns become four
steps top to bottom with the return path as a dashed rule down the left edge.
The brief says 1024, but the container there is 960px wide and the horizontal
diagram's labels would land under 11px. Restructuring one breakpoint earlier is
the same instruction applied honestly.

**Motion.** One 8px dot on an `offset-path`, six seconds, linear, continuous, no
controls. It pauses when the band leaves the viewport. On `Held for a person` it
stops for a second at the rule engine while the approval gate turns amber.
Nothing else moves. Under reduced motion the dot is removed and every node
renders at rest.
