# OMP Executor Conformance Plan

Status: FAIL-FIRST PLAN — NO ADAPTER IMPLEMENTATION YET
Phase: 11 — OMP Executor Contracts
Depends on:
- `RFC-004 — OMP ExecutorPort Adapter`
- `EXECUTION-LAUNCH-SPEC.md`
- `OMP-EXECUTION-REGISTRY.md`

## 1. Test strategy

OMP conformance is split into three independent TDD phases so failures are attributable:

```text
Phase 12
LaunchSpec validation + durable OmpExecutionRegistry
          ↓
Phase 13
OmpExecutorAdapter state machine against injected fake OMP runtime
          ↓
Phase 14
Real @oh-my-pi/pi-coding-agent SDK conformance
```

D-010/D-016 cannot be accepted by Phase 12 or Phase 13 alone.

## 2. Phase 12 — LaunchSpec + Registry

### LAUNCH-001 — exact execution identity

Resolved spec identity must exactly equal `ExecutorStartRequest`.

### LAUNCH-002 — exact provenance bindings

Artifact/evidence/approval IDs must match as immutable sets/sequences according to contract; mismatch rejects launch.

### LAUNCH-003 — explicit absolute workspace

Relative/empty cwd or invalid additional directories are rejected.

### LAUNCH-004 — materialized instruction

Empty/whitespace-only instruction is rejected.

### LAUNCH-005 — explicit model/reasoning

Empty model selector or unsupported reasoning profile is invalid.

### LAUNCH-006 — fail-closed tool allowlist

Tool names must be unique/non-empty. Empty list is valid and means no tools.

### LAUNCH-007 — structured output contract

Non-empty schema ref and object JSON Schema are required.

### LAUNCH-008 — deadline

Deadline must be finite and valid; adapter start also rejects already-expired specs.

### OMPREG-001 — first prepare

First valid ExecutionId/session/spec mapping is PREPARED.

### OMPREG-002 — identical prepare replay

Exact replay returns REPLAYED without a second mapping.

### OMPREG-003 — immutable mapping conflict

Different launch spec, session ID, or session file under the same ExecutionId returns CONFLICT.

### OMPREG-004 — PREPARED -> ACTIVE

Valid activation persists exactly once.

### OMPREG-005 — ACTIVE -> SUCCEEDED

Success requires exact ExecutionId, matching schema ref, and structured validated output.

### OMPREG-006 — ACTIVE -> FAILED

Failure may settle without structured output.

### OMPREG-007 — terminal immutability

Conflicting terminal replay is rejected; identical replay is idempotent.

### OMPREG-008 — interrupted lifecycle

PREPARED/ACTIVE can be marked INTERRUPTED; terminal records cannot.

### OMPREG-009 — restart durability

Mapping/lifecycle/result survives close/reopen.

### OMPREG-010 — concurrent prepare race

Two processes/connections cannot bind one ExecutionId to divergent OMP sessions/specs.

### OMPREG-011 — corruption fail-closed

Malformed persisted spec/lifecycle/output returns INTEGRITY_ERROR.

### OMPREG-012 — authority isolation

Registry public API has no graph/execution dispatch/tool methods.

## 3. Phase 13 — Adapter state machine with fake OMP runtime

The adapter must depend on an injectable OMP-specific runtime bridge for deterministic tests. The production bridge is implemented/tested separately in Phase 14.

### OMP-001 — launch spec missing/invalid

Return REJECTED without creating an OMP session.

### OMP-002 — durable prepare before activation

Fake runtime ordering proves registry PREPARED commit occurs before prompt activation.

### OMP-003 — exact runtime configuration

Adapter passes exactly:

- cwd/additional directories;
- model selector;
- reasoning profile mapping;
- tool allowlist;
- restricted-tool mode;
- output schema;
- strict schema mode;
- required yield;
- deadline.

No ambient tool expansion is requested.

### OMP-004 — start returns before terminal completion

A pending fake turn produces `STARTED`; the start call does not wait for terminal future settlement.

### OMP-005 — live replay

Same ExecutionId while live returns ALREADY_STARTED with the same executor reference and does not invoke a second prompt.

### OMP-006 — durable terminal replay

Already terminal ExecutionId returns ALREADY_COMPLETED after adapter reconstruction/restart.

### OMP-007 — PREPARED status

Prepared but never activated execution returns NOT_FOUND, allowing safe same-ID start.

### OMP-008 — ACTIVE live status

Active live runtime returns RUNNING.

### OMP-009 — orphan ACTIVE after restart

Active durable record with no live runtime becomes INTERRUPTED/UNKNOWN; no prompt is started.

### OMP-010 — structured success settlement

Schema-valid terminal structured output persists SUCCEEDED and returns a durable result ref.

### OMP-011 — structured output violation

Missing/invalid terminal structured output cannot become SUCCEEDED.

### OMP-012 — non-terminal agent_end

`agent_end` where upstream indicates non-terminal continuation cannot settle AI-STACK execution.

### OMP-013 — terminal lifecycle without accepted structured yield

Terminal OMP turn without required valid output becomes explicit failure/contract violation, not success inferred from prose.

### OMP-014 — tool restriction/configuration failure

Adapter rejects launch rather than running with a broader toolset.

### OMP-015 — launch binding conflict

Same ExecutionId with changed launch material returns REJECTED/CONFLICT and starts nothing.

### OMP-016 — session construction failure

Failure before durable activation leaves no false RUNNING/terminal result.

### OMP-017 — expired deadline

Already-expired launch never starts.

### OMP-018 — runtime throw after activation

Adapter settles FAILED only when failure is trustworthy; otherwise records INTERRUPTED and getStatus returns UNKNOWN.

### OMP-019 — no graph authority

Adapter and runtime bridge have no graph commit/journal/gate approval surface.

## 4. Phase 14 — real OMP SDK conformance

Real integration must pin the tested OMP package version/commit evidence.

Required proof:

### OMP-SDK-001 — SessionManager mapping

Create file-backed session in explicit cwd/sessionDir, ensure sessionFile/sessionId are observable, close/open same session successfully.

### OMP-SDK-002 — restricted tools

A session configured with `toolNames + restrictToolNames` exposes only the requested tool names plus any explicitly documented mandatory protocol tool; ambient MCP/discovered tools do not appear.

### OMP-SDK-003 — model/reasoning/deadline mapping

Requested launch config is reflected in the constructed session or rejected explicitly.

### OMP-SDK-004 — top-level structured completion

A real AgentSession configured with `outputSchema`, strict mode, and required yield demonstrates the expected structured terminal payload semantics.

### OMP-SDK-005 — schema violation

Invalid structured output does not become successful terminal execution.

### OMP-SDK-006 — terminal event semantics

Adapter correctly handles terminal vs non-terminal `agent_end` behavior observed from the actual SDK.

### OMP-SDK-007 — async start/live observation

Adapter returns STARTED while a real turn is live; getStatus reports RUNNING from live adapter state.

### OMP-SDK-008 — terminal persistence/restart

After terminal settlement, a new adapter instance using the same durable registry returns ALREADY_COMPLETED / terminal getStatus without model re-execution.

### OMP-SDK-009 — host-restart orphan safety

Simulated adapter restart with an ACTIVE registry record and no live runtime returns UNKNOWN/INTERRUPTED and does not automatically invoke another prompt.

### OMP-SDK-010 — generic contract isolation

No OMP type/import appears in generic `contracts/execution*`, dispatcher, projector, or runner layers.

## 5. Credential/provider strategy

Phase 14 must not make normal CI depend on a developer's paid/provider credentials.

Preferred order:

1. use an upstream-supported deterministic test/fake provider path if available and representative of AgentSession lifecycle/tool/yield behavior;
2. otherwise provide a dedicated opt-in integration job with explicit secret/provider configuration;
3. never silently skip real-SDK conformance while marking D-010/D-016 accepted.

If real lifecycle semantics cannot be tested reproducibly, those decisions remain PROPOSED.

## 6. Acceptance

Phase 12 acceptance proves only launch/registry durability.

Phase 13 acceptance proves adapter logic against the OMP-runtime contract, not actual OMP behavior.

Only Phase 14 may promote:

- D-010 — OMP integration boundary;
- D-016 — OMP stable-identity external execution semantics.

Automatic interrupted-session recovery is not required for acceptance if the adapter demonstrably fails closed as UNKNOWN and prevents uncontrolled duplicate work.
