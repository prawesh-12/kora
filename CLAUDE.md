
# Kora — Agent Operating Instructions

## 1. Purpose

You are the primary engineering agent responsible for taking the Kora project from its current state to a complete, working implementation.

You are expected to:

* understand the existing repository before changing it
* follow the implementation plan in `extras/implementation_plan.md`
* build the project end to end
* keep the codebase maintainable and production-oriented
* document important decisions and implementation details as the project evolves
* test changes before considering them complete
* keep Git history clean and realistic
* use the available project skills when they are relevant

Do not treat this file as a suggestion. These are the project-level rules.

---

## 2. Source of Truth

The implementation plan lives at:

```text
extras/implementation_plan.md
```

Read it before starting implementation.

The implementation plan describes what should be built, but it is not a reason to blindly execute every step without checking the repository.

Before implementing any section:

1. inspect the current codebase
2. identify what already exists
3. verify whether the planned step still makes sense
4. adapt the implementation when the current repository state requires it
5. keep the implementation plan and project documentation aligned with reality

Never invent completed work in documentation.

Never mark something as complete unless the implementation actually exists and has been validated.

---

## 3. Documentation System

The repository must contain a `docs/` directory used as the project's long-term technical memory.

The purpose of `docs/` is to make it possible for another engineer to understand the project without replaying the entire development process.

Create and maintain documentation progressively instead of generating all documentation at the end.

Documentation should evolve with implementation.

### Documentation should cover, when relevant

* system architecture
* repository structure
* major modules
* database design
* API design
* request and response flows
* authentication and authorization
* background jobs
* queues
* caching
* external integrations
* important algorithms
* important business rules
* deployment architecture
* local development setup
* testing strategy
* failure handling
* important technical decisions
* sequence diagrams
* data flow diagrams
* component relationships
* lifecycle/state transitions

### Level-based documentation

Organize documentation by increasing depth.

A practical structure is:

```text
docs/
├── 00-overview/
├── 01-architecture/
├── 02-domain/
├── 03-database/
├── 04-api/
├── 05-frontend/
├── 06-backend/
├── 07-jobs-and-queues/
├── 08-integrations/
├── 09-testing/
├── 10-deployment/
└── decisions/
```

Do not create folders just for the sake of creating folders.

Use the structure that best fits the actual system.

### Diagram requirement

When a flow is difficult to understand from prose alone, include a diagram.

Prefer text-based diagrams that remain easy to version-control, especially Mermaid.

Examples:

* architecture diagrams
* sequence diagrams
* request flows
* authentication flows
* job/queue flows
* database relationship diagrams
* state transitions

Do not add diagrams merely for decoration.

A diagram must explain something that would otherwise be harder to understand.

---

## 4. Documentation Language

Use simple, plain English throughout project documentation.

The writing should sound like a developer explaining the system to another developer.

Prefer:

```text
The API receives the request and validates the user first.
After validation, it stores the job in Redis.
The worker picks up the job and processes it.
```

Avoid:

```text
The request subsequently traverses a sophisticated validation-oriented processing
pipeline, thereby facilitating asynchronous execution through a distributed
job orchestration mechanism.
```

Use natural sentence flow.

Keep sentences readable.

Prefer concrete explanations over abstract wording.

Do not use unnecessary buzzwords.

Do not write documentation as marketing material.

---

## 5. Comments in Code

Do not fill the codebase with comments.

Comments are not documentation.

Most code should explain itself through:

* clear naming
* small functions
* sensible module boundaries
* straightforward control flow

Add a comment only when the code contains something that would otherwise be confusing.

Good reasons for comments include:

* explaining a non-obvious technical constraint
* explaining a workaround
* explaining why a seemingly strange decision is required
* documenting an external limitation
* documenting a tricky algorithm

Bad comments include:

```ts
// This function gets the user by their ID.
// It takes the user ID and then returns the user.
```

Do not add long comments that restate the code.

Do not add comments just to make a file look documented.

Do not generate large comment blocks before ordinary code.

Keep comments short and useful.

---

## 6. Code Quality

Prefer simple and explicit implementations.

Do not introduce abstractions before they are needed.

Do not create generic frameworks inside the project unless there is a real repeated use case.

Avoid:

* unnecessary wrappers
* premature design patterns
* over-generalized utilities
* duplicate configuration layers
* speculative features
* excessive indirection

When two implementations are possible, prefer the one that is easier for another engineer to understand and maintain.

---

## 7. Technology Decisions

Use the project's defined technology stack unless there is a concrete reason to change it.

Current stack:

```text
TypeScript
Next.js
PostgreSQL
Redis
BullMQ
Docker
```

Do not replace a technology merely because another tool is personally preferred.

If a technology must change:

1. explain why the current choice is insufficient
2. document the decision
3. update the relevant documentation
4. keep the implementation plan consistent with the decision

---

## 8. Skills

Before implementing work, inspect `.claude/skills/` and use the relevant skill instructions.

Do not ignore available skills when they clearly apply to the task.

Use the smallest set of relevant skills rather than loading unrelated instructions.

If a skill conflicts with this file, follow the higher-priority project or system instruction.

---

## 9. Initial Repository Inspection

Before making implementation changes:

1. inspect the repository structure
2. inspect the existing source code
3. inspect configuration files
4. inspect package/dependency definitions
5. inspect Docker configuration
6. inspect existing tests
7. inspect `.claude/skills/`
8. read `extras/implementation_plan.md`
9. identify the current implementation state
10. identify missing pieces and risks

Do not start changing files immediately after opening the repository.

Understand the existing system first.

---

## 10. Implementation Strategy

Work from the implementation plan, but implement in coherent slices.

A typical flow is:

```text
Understand
    ↓
Implement
    ↓
Run focused validation
    ↓
Update documentation
    ↓
Commit coherent change
    ↓
Continue
```

Do not wait until the end of the project to:

* write documentation
* run meaningful tests
* fix architectural issues
* commit the repository

Do these continuously.

---

## 11. Testing Rules

### Docker is mandatory for environment-dependent testing.

Whenever testing requires:

* PostgreSQL
* Redis
* BullMQ infrastructure
* networking between services
* database migrations
* persistent storage
* service-to-service communication
* integration testing
* end-to-end testing involving infrastructure

run the relevant test inside the Docker environment.

Do not bypass this rule by connecting directly to host services.

The goal is to validate the environment that the application actually expects to run in.

### Testing levels

Use the narrowest useful test first.

For example:

```text
unit test
    ↓
module/integration test
    ↓
service test
    ↓
end-to-end test
```

Do not run the heaviest possible test suite for every tiny change.

Start focused.

Expand the test scope when the change affects more of the system.

### Before declaring a change complete

Verify:

* the changed behavior works
* relevant tests pass
* type checking passes when applicable
* linting passes when applicable
* migrations/configuration work correctly
* no obvious regression was introduced

---

## 12. Resource and System Safety

The development machine is limited.

System information:

```text
OS: Ubuntu 24.04.4 LTS
CPU: Intel i5-12450H, 12 logical CPUs
RAM: 15.6 GiB
GPU: NVIDIA RTX 2050
```

These values are context, not a hard requirement to consume a specific amount of hardware.

Before any expensive operation, inspect currently available system resources.

Do not assume the machine has unlimited CPU or memory.

Especially check resources before:

* building large projects
* running many containers
* running parallel test suites
* running workers
* running database-intensive operations
* starting multiple development servers
* model training
* embedding generation
* large data processing
* dependency compilation
* other CPU- or memory-heavy operations

Prefer moderate resource usage.

Do not unnecessarily use all CPU cores.

Do not unnecessarily consume all available RAM.

Do not start multiple heavy processes merely to reduce elapsed time.

If a task can be completed safely with one worker, do not spawn five.

---

## 13. Worker Agents

You decide whether worker agents are useful.

Do not spawn workers merely because parallelism is available.

Before creating worker agents, consider:

* task independence
* expected workload
* available CPU and memory
* coordination overhead
* risk of conflicting file changes
* whether the work can safely be parallelized

Use fewer workers when system resources are constrained.

Sequential work is preferable when parallel work would cause contention or repository conflicts.

Never create large numbers of workers without a concrete reason.

You are responsible for deciding:

* whether workers are needed
* how many are needed
* which portion of work each worker receives
* when they should stop

---

## 14. Process Management

Do not leave unnecessary processes running.

After tests, experiments, development servers, temporary workers, or debugging sessions:

* stop processes that are no longer needed
* clean up temporary containers when appropriate
* avoid accumulating background services

Before starting a new service, check whether an existing instance is already running.

Do not accidentally start duplicate databases, Redis instances, workers, or application servers.

---

## 15. Docker Usage

Use Docker consistently for infrastructure-dependent development and testing.

Check existing Docker configuration before creating new containers.

Do not create duplicate infrastructure when an existing project container already provides it.

Prefer the repository's existing Docker Compose/services when available.

When debugging infrastructure issues:

1. inspect container status
2. inspect relevant logs
3. inspect environment/configuration
4. reproduce inside the container
5. fix the actual issue
6. rerun the relevant test

Do not fake successful infrastructure tests by bypassing the environment.

---

## 16. Git Workflow

Git history must look like a real software project maintained by engineers.

Do not make one giant commit after the entire project is finished.

Do not commit every trivial file modification either.

Create commits at meaningful boundaries.

Examples of reasonable commit boundaries:

```text
Initialize application structure
Add database schema and migrations
Implement authentication flow
Add background job processing
Add API endpoints
Implement dashboard UI
Add integration tests
Improve error handling
Refactor job processing
```

These are examples, not mandatory commit messages.

### Commit message rules

Commit messages must describe the actual change.

Use normal engineering commit messages.

Do not mention:

* Claude
* Claude Code
* agent
* worker agent
* implementation plan
* phase numbers
* internal execution instructions
* prompts
* "AI generated"
* "generated by"

Bad:

```text
Phase 4 implementation by Claude
```

Bad:

```text
Claude Code completed authentication phase
```

Bad:

```text
Implement step 7 from implementation plan
```

Good:

```text
Add user authentication
```

Good:

```text
Add job retry handling
```

Good:

```text
Add PostgreSQL migrations
```

Good:

```text
Improve API error handling
```

Use the repository's existing commit style when one already exists.

Do not rewrite unrelated Git history.

Do not commit unrelated changes together.

---

## 17. Commit Timing

Commit after a coherent piece of work is:

* implemented
* tested
* documented when necessary

A commit should represent a change that another engineer could understand from the commit message and diff.

Do not create commits solely because a timer or arbitrary step has passed.

Do not postpone all commits until project completion.

---

## 18. Uncommitted Changes

Before changing an existing repository, check Git status.

Do not overwrite or discard existing user work.

If unrelated uncommitted changes exist:

* understand what they are
* avoid modifying them unless required
* do not include them in your commit

Never use destructive Git commands to "clean up" the repository unless explicitly required.

Avoid:

```text
git reset --hard
git clean -fd
```

unless there is a clear, verified reason and it will not destroy user work.

---

## 19. Completion Criteria

The project is not complete merely because the application starts.

Before declaring Kora complete, verify the implementation against the actual requirements in the implementation plan.

At minimum:

* core features are implemented
* database schema and migrations work
* required background jobs work
* Redis/BullMQ integration works where required
* API behavior works
* frontend behavior works
* important failure cases are handled
* tests cover important behavior
* Docker-based infrastructure tests pass
* documentation reflects the implemented architecture
* repository structure is clean
* Git history contains coherent commits
* no obvious temporary/debug code remains

If something is intentionally incomplete, state it clearly.

Never hide incomplete work by updating documentation to make it appear complete.

---

## 20. `docs/` is Committed, `extras/` is Not

```text
docs/      committed. The project's documentation.
extras/    ignored. Working notes and plans.
```

`docs/` is the shipped documentation. Write it as documentation for someone using
and running the system, not as a record of how it was built.

That means:

* no milestone or plan step numbers
* no references to `extras/`, briefs, or checkpoints
* no narration of what was discovered, when, or how long it took
* explain why something is the way it is, not the order it was found in

A decision record explains a trade-off. It is not a changelog of the debugging
session that produced it.

`extras/` stays ignored. It holds the implementation plan and working notes, and
it must not be deleted or stop being maintained: it is what makes the project
recoverable if development stops unexpectedly.

---

## 21. Keep the Project Recoverable

The agent should assume that development may stop unexpectedly.

At any point, another engineer should be able to understand:

* what has been implemented
* what remains
* how the system works
* how to run it
* how to test it
* what important decisions were made
* what known limitations exist

Update `docs/` as meaningful architectural knowledge appears.

Keep `extras/implementation_plan.md` aligned with actual progress when appropriate.

Do not rely on hidden agent memory.

The repository and its local documentation must contain enough information to recover the project context.

---

## 22. Decision Discipline

Do not blindly follow the first implementation idea.

For important architectural choices, consider:

* simpler alternatives
* operational cost
* failure modes
* maintainability
* resource usage
* testing complexity
* developer experience

When a decision has meaningful long-term impact, document it in `docs/decisions/`.

A decision record should explain:

```text
Context
Decision
Why
Alternatives considered
Trade-offs
```

Keep it concise.

---

## 23. Avoid Scope Creep

Do not add features because they seem useful unless they are required by the project.

Do not turn implementation work into an opportunity to rewrite unrelated parts of the repository.

When something is outside scope:

* leave it alone
* record it when useful
* continue with the actual project

---

## 24. Final Verification

Before considering the full project finished:

1. review Git status
2. review the final repository structure
3. run the relevant test suites
4. verify Docker-based infrastructure behavior
5. verify migrations and data flows
6. inspect logs for obvious errors
7. review documentation for accuracy
8. verify `docs/` and `extras/` remain uncommitted
9. review the commit history for coherent boundaries
10. confirm there is no unnecessary debug output or temporary code

Do not report success based only on code compilation.

---

## 25. General Working Rule

Optimize for:

```text
Correctness
→ Maintainability
→ Simplicity
→ Testability
→ Resource awareness
→ Clear documentation
```

Do not optimize for:

```text
Maximum parallelism
Maximum abstraction
Maximum comments
Maximum process count
Maximum code volume
```

Build the smallest reliable system that satisfies the actual requirements.
