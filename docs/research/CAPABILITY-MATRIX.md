# Capability Matrix

Status: WORKING DRAFT

This matrix records architectural fit, not popularity. Scores are provisional until source-backed deep dives are completed.

| Capability | gstack | Superpowers | BMAD | OpenSpec | Spec Kit | Ralph | GSD |
|---|---|---|---|---|---|---|---|
| Product discovery | A+ | B | A+ | B | B | C | B |
| PRD / planning | A | B+ | A+ | B+ | A | B | A |
| Formal specs | B | B | A- | A+ | A+ | B | A- |
| Change management | B | C | B | A+ | A | B | B |
| Architecture review | A | B | A | B | B | C | B |
| Strict TDD | C+ | A+ | B | C | C | B | B |
| Context isolation | B | A- | B | B | B | A | A |
| Subagent execution | B | A | A | C | A | C | A |
| Code review | A | A | A- | C | Extensible | B | B+ |
| Browser QA | A+ | C | B | C | Extensible | C | C |
| Security review | A | B | B | C | Extensible | C | B |
| Verification | A | A+ | A- | B+ | A | B+ | A |
| Human gates | B+ | B | A | B | A | B | B |
| Workflow state | B | C | B | B | A+ | A- | A |
| Graph primitives | C | C | C | C | A | C | C |
| Eval philosophy | B | A | B | C | Extensible | C | C |
| OMP architectural fit | B | A- | C | B | A | C | Reference only |
| Dependency health | A | A | A | A | A | B | F |

## Primitive disposition

| Primitive | Source | Current disposition |
|---|---|---|
| Product interrogation | gstack | ADAPT |
| Strategic product review | gstack | ADAPT |
| Product brief / PRD discovery | BMAD | ADAPT |
| Research workflows | BMAD | ADAPT |
| Change-oriented spec model | OpenSpec | ADAPT |
| Artifact pipeline | Spec Kit | ADAPT |
| Workflow graph semantics | Spec Kit | REIMPLEMENT minimal core |
| TDD discipline | Superpowers | KEEP semantics / ADAPT integration |
| Systematic debugging | Superpowers + gstack | ADAPT |
| Fresh-agent-per-task | Superpowers | KEEP semantics |
| Isolated worktree execution | OMP | KEEP native |
| Typed subagent results | OMP | KEEP native |
| Context reset per unit | Ralph / GSD | ADAPT |
| Atomic task commits | Ralph / GSD | ADAPT |
| Code review | OMP + Superpowers | KEEP + ADAPT |
| Browser QA | gstack | ADAPT |
| Security review | gstack | ADAPT, non-authoritative |
| Skill eval methodology | Superpowers | ADAPT |
| Artifact lineage | AI-STACK | OWN |
| Evidence store | AI-STACK | OWN |
| Policy engine | AI-STACK | OWN |
| Permission model | AI-STACK | OWN |
| Graph transition validator | AI-STACK | OWN |
| GSD runtime/framework | GSD | REJECT |
| Full BMAD orchestration | BMAD | REJECT |
| Full gstack orchestration | gstack | REJECT |
| Superpowers as control plane | Superpowers | REJECT |

## Research rule

No score in this matrix is an architectural contract until it is supported by a dedicated research note and accepted through STACK-RFC-001 or a subsequent ADR/RFC.
