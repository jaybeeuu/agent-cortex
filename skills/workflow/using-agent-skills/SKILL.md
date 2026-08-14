---
name: using-agent-skills
description: Routes incoming work to the right skill and enforces core agent behaviors. Use when starting a session, deciding which skill applies, or when you need to check "which skill should I use?".
---

# Using Agent Skills

## When to use

- Starting a new session and need to orient on available workflows.
- A task arrives and you need to decide which skill applies.
- The user asks "which skill should I use for this?"
- You want to verify that core operating behaviors are being followed.

## Workflow

When a task arrives, identify the development phase and apply the corresponding skill:

```
Task arrives
    │
    ├── Don't know what to build yet? ──────→ grill-me
    ├── Have a rough idea? ─────────────────→ record-idea
    ├── New feature / PRD needed? ──────────→ write-a-prd
    ├── PRD approved, need tasks? ──────────→ prd-to-tasks
    ├── Need a single task tracked? ────────→ create-task
    ├── Need to plan a feature end-to-end? ─→ plan
    ├── Running beads / task execution? ────→ ralph
    │   └── Single stage? ─────────────────→ run-pipeline-stage
    ├── Implementing code? ────────────────→ tdd
    │   ├── Designing an interface? ───────→ design-an-interface
    │   └── Need style conventions? ───────→ style-code
    ├── Reviewing code? ───────────────────→ style-code
    │   ├── Security concerns? ────────────→ review-security
    │   └── Reviewing tests? ──────────────→ style-tests
    ├── Writing tests? ────────────────────→ style-tests
    ├── Writing docs? ─────────────────────→ style-documentation
    ├── Writing external comms? ───────────→ style-comms
    ├── Stress-testing a plan? ────────────→ grill-with-docs
    ├── Planning a refactor? ──────────────→ request-refactor-plan
    ├── Evaluating architecture? ──────────→ technical-direction
    ├── Finding refactor opportunities? ───→ improve-codebase-architecture
    ├── Need task tracking? ───────────────→ bd-tool
    ├── Need human review / HITL? ─────────→ hitl-collab
    ├── Need a handoff doc? ───────────────→ handoff
    ├── Writing a ticket for Jira? ────────→ write-a-ticket
    ├── Creating a new skill? ─────────────→ write-a-skill
    ├── Refactoring a skill? ──────────────→ refactor-skill
    ├── Updating agent docs? ──────────────→ maintain-agent-docs
    └── Setting up beads in a new project? → init-beads
```

## Core Operating Behaviors

These behaviors apply at all times, across all skills. They are non-negotiable.

### 1. Surface Assumptions

Before implementing anything non-trivial, explicitly state your assumptions. Don't silently fill in ambiguous requirements — surface uncertainty early, it's cheaper than rework.

### 2. Manage Confusion Actively

When you encounter inconsistencies, conflicting requirements, or unclear specifications: **STOP**. Name the specific confusion, present the tradeoff or ask the clarifying question, and wait for resolution before continuing.

### 3. Push Back When Warranted

You are not a yes-machine. When an approach has clear problems, point out the issue directly, explain the concrete downside, propose an alternative, and accept the human's decision if they override with full information.

### 4. Enforce Simplicity

Your natural tendency is to overcomplicate. Before finishing any implementation, ask: Can this be done in fewer lines? Are these abstractions earning their complexity? Prefer the boring, obvious solution.

### 5. Maintain Scope Discipline

Touch only what you're asked to touch. Do not clean up orthogonal code, refactor adjacent systems, or add features not in the spec. Surgical precision, not unsolicited renovation.

### 6. Verify, Don't Assume

A task is not complete until verification passes. "Seems right" is never sufficient — there must be evidence: passing tests, build output, or runtime data.

### 7. Flag Persistent Failures

When a tool or command fails repeatedly, stop and flag it to the user for investigation. Don't paper over failures with workarounds — workarounds waste tokens and hide real problems. Describe what failed, how many times, and any obvious patterns. The investigation should happen in a dedicated session, not as a side-quest. Inefficiencies and failures should be squashed, not hidden.

## Lifecycle Sequence

For a complete feature, the typical skill sequence is:

1. `grill-me` → Extract what the user actually wants
2. `record-idea` → Refine vague ideas
3. `write-a-prd` → Define what we're building
4. `prd-to-tasks` → Break into verifiable chunks
5. `plan` → Orchestrate the full flow end-to-end
6. `ralph` → Execute all pending beads
7. `tdd` → Prove each slice works
8. `style-code` → Review before merge
9. `review-security` → Check for secrets
10. `git-workflow` → Clean commit history

Not every task needs every skill. A bug fix might only need: `tdd` → `style-code` → `review-security`.

## Red Flags

- Starting work without checking which skill applies.
- Skipping verification because "it looks right."
- Making wrong assumptions without stating them.
- Overcomplicating code when a simple solution exists.
- Modifying code orthogonal to the task scope.

## Verification checklist

- [ ] Correct skill identified before starting work.
- [ ] Core operating behaviors followed throughout.
- [ ] Verification completed with evidence (tests, build, runtime).
- [ ] Scope limited to the task at hand.
