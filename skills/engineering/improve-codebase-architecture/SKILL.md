---
name: improve-codebase-architecture
description: Explore a codebase to find opportunities for architectural improvement, focusing on making the codebase more testable by deepening shallow modules. Use when user wants to improve architecture, find refactoring opportunities, consolidate tightly-coupled modules, or make a codebase more AI-navigable.
---

# Improve Codebase Architecture

Explore a codebase like an AI would, surface architectural friction, discover opportunities for improving testability, and propose module-deepening refactors as beads.

A **deep module** (John Ousterhout, "A Philosophy of Software Design") has a small interface hiding a large implementation. Deep modules are more testable, more AI-navigable, and let you test at the boundary instead of inside.

## Process

### 1. Explore the codebase

Explore the codebase using your available tools ({{TOOL:bash}}, {{TOOL:rg}}, {{TOOL:view}}, {{TOOL:glob}}). Navigate organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small files?
- Where are modules so shallow that the interface is nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called?
- Where do tightly-coupled modules create integration risk in the seams between them?
- Which parts of the codebase are untested, or hard to test?

The friction you encounter IS the signal.

### 2. Present candidates

Present a numbered list of deepening opportunities. For each candidate, show:

- **Cluster**: Which modules/concepts are involved
- **Why they're coupled**: Shared types, call patterns, co-ownership of a concept
- **Dependency category**: See [REFERENCE.md](REFERENCE.md) for the four categories
- **Test impact**: What existing tests would be replaced by boundary tests

Do NOT propose interfaces yet. Ask the user: "Which of these would you like to explore?"

### 3. User picks a candidate

### 4. Frame the problem space

Before spawning sub-agents, write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would need to rely on
- A rough illustrative code sketch to make the constraints concrete — this is not a proposal, just a way to ground the constraints

Show this to the user, then immediately proceed to Step 5. The user reads and thinks about the problem while the sub-agents work in parallel.

### 5. Design multiple interfaces

Design multiple radically different interfaces for the deepened module yourself, cycling through different constraints. For each design, write out the complete interface and evaluate it before moving to the next:

1. **Minimal interface** — aim for 1-3 entry points max. What complexity can you hide behind a small surface area?
2. **Flexible interface** — support many use cases and extension. How do you make it open for future needs?
3. **Caller-optimised** — make the most common calling pattern trivial. What does the primary caller look like?
4. **Ports & adapters** (if cross-boundary deps) — isolate side effects from pure logic.

For each design, output:

1. Interface signature (types, methods, params)
2. Usage example showing how callers use it
3. What complexity it hides internally
4. Dependency strategy (how deps are handled — see [REFERENCE.md](REFERENCE.md))
5. Trade-offs

The `design-an-interface` skill provides a structured approach for this step — invoke it if you want a guided parallel-design flow with sub-agents.

Present designs sequentially, then compare them in prose.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated — the user wants a strong read, not just a menu.

### 6. User picks an interface (or accepts recommendation)

### 7. Create refactor bead

Invoke the `create-task` skill, passing:
- **title**: a concise name for the refactor
- **description**: the bead body using the template in [REFERENCE.md](REFERENCE.md)
- **priority**: P2

**Always use `create-task`** — never call `bd create` directly for tasks. `create-task` classifies the bead and expands AFK tasks into pipeline stage children that ralph can execute. Do NOT ask the user to review before creating — just create it and share the bead ID.
