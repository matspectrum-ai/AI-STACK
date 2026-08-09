# AI-STACK Engineering Constitution

This repository is governed by specification-first, evidence-backed engineering.

## Mandatory execution order

1. Problem Analysis
2. Specification
3. Contracts
4. Tests (RED)
5. Implementation (GREEN)
6. Refactor
7. Verification and technical explanation

Implementation must not begin before the behavior is contract-defined and fail-first tests exist.

## Architectural authority

- AI-STACK owns the Engineering Graph control plane.
- OMP / OhMyPI is the primary execution kernel.
- External frameworks are sources of primitives only; they do not own workflow state or policy authority.
- Agent output is advisory until validated by deterministic gates and recorded evidence.

## Core disciplines

- Document-Driven Development
- Spec-Driven Development
- Contract-Driven Development
- Test-Driven Development
- Context-Driven Development
- Eval-Driven Development
- Graph Engineering

## Required properties

- deterministic transitions
- explicit state
- explicit permissions
- artifact lineage
- evidence-backed gates
- bounded retries and explicit failure paths
- isolated execution where feasible
- observable execution
- no hidden side effects
- no agent self-approval for authoritative gates

## TDD contract

The required lifecycle is:

`SPEC -> CONTRACT -> TEST -> RED -> IMPLEMENT -> GREEN -> REFACTOR -> VERIFY`

A transition to implementation must be denied when specification, contract, or valid RED evidence is absent.

## Git discipline

Each completed phase must end with:

1. validation
2. atomic commit(s)
3. push
4. pull request or explicit recorded decision

Do not accumulate completed phases without durable Git checkpoints.

## Change governance

Architecture changes require an RFC or ADR according to scope. A decision is not considered accepted merely because it appears in chat, an agent response, or an implementation diff.
