# Gas City Research Notes

This is a promoted research note.


Research conducted 2026-05-03/04. Source: `gastownhall/gascity` and related `gastownhall/*` repos.

---

## What is Gas City?

Gas City is a Go-based multi-agent orchestration SDK (`gc` CLI, v1.0.0, released 2026-04-21, MIT licence).
It manages **live interactive agent sessions** (Claude Code, Codex CLI, etc. running in tmux) rather than
making raw LLM API calls. It is not a replacement for LLM API access — it is a rack manager for persistent
agent processes.

Gas City is built on the **MEOW stack** (Molecular Expression of Work) — the same `bd` (beads) tooling
already in use in this repo.

---

## The MEOW Stack

MEOW = **Molecular Expression of Work**. A layered work-decomposition and tracking infrastructure:

```
Formulas / Orders    ← TOML templates defining workflow shape + when it fires
       ↑
Molecules / Wisps    ← durable chained bead workflows; instances of formulas
       ↑
Epics                ← hierarchical bead grouping (parent/child beads)
       ↑
Beads                ← atomic git-backed work units (the bd CLI)
```

**Core insight:** work is the primitive, not orchestration. The controller is a thin layer on top of the
MEOW stack. Work definition and tracking is what matters; orchestration shape is configurable on top.

**GUPP (Gas Town Universal Propulsion Principle):** *"If you find something on your hook, you run it."*
Agents are stateless pistons; the bead store is the engine.

---

## Key Concepts

### Rigs
A **rig** is an external project directory (git repo) registered with a city. Each rig gets its own beads
database, agent hooks, and pack expansion. One city can manage multiple rigs (multiple repos) — this is
the primary multi-repo use case.

```toml
# city.toml
[[rigs]]
name = "my-api"

[[rigs]]
name = "my-frontend"
```

### City
A deployment of packs + rigs under one controller. The controller runs as a persistent Go process managing
all sessions in all rigs.

### Packs / Formulas
Reusable TOML configuration bundles. A **formula** is a TOML workflow template defining steps and
dependencies. A **molecule** is an instance of a formula — materialised as beads in the store.

### Convergence
The outer retry loop. When a wisp closes, the controller's `HandleWispClosed()` (a 9-step deterministic
Go algorithm) evaluates a gate and decides: `iterate` (new wisp), `approved` (done), `no_convergence`
(blocked), or `waiting_manual` (human required).

### Orders
Scheduled formula dispatch. Five trigger types: `cooldown`, `cron`, `condition` (shell exit 0), `event`
(bead.closed on city bus), `manual`. Can dispatch a formula to an agent pool, or run a shell script
directly (`exec` orders — no LLM involved).

---

## What Gas City Gives Us

| Capability | Status |
|---|---|
| Multi-repo orchestration (rigs) | ✅ Native — primary use case |
| Rack / dashboard (`gc status`, SPA) | ✅ Built-in |
| Agent lifecycle (crash recovery, idle-kill, restart) | ✅ Built-in |
| Worktree isolation (per-agent git branch) | ✅ `isolation = "worktree"` in agent config |
| Concurrent feature work (multiple agents, multiple branches) | ✅ Via pool + worktree isolation |
| Scheduling / reactive triggers (Orders) | ✅ 5 trigger types |
| Deterministic workflow routing | ✅ Controller is Go state machine (no LLM in routing path) |
| Formula-based step sequencing | ✅ TOML DAG, `needs` dependencies, executed by `bd` |
| Feature backlog isolation (separate bead stores) | ⚠️ Requires separate rigs; not automatic |
| Cross-repo bead dependencies | ❌ Not supported — issue #587, milestone `1.0+`, no timeline |
| Native loops in formulas | ❌ Formulas are DAGs; loops require the convergence engine |

---

## Architecture: Determinism vs. Agents

Gas City has a sharp boundary. The Go controller owns all routing; LLMs only do work and emit a verdict.

```
Agent works through formula steps
    → writes convergence.agent_verdict = "approve" | "block"
    → closes wisp

Controller HandleWispClosed() [pure Go, 9-step algorithm]
    → reads verdict (scoped to this wisp by agent_verdict_wisp)
    → runs gate shell script (exit 0 = pass, exit 1 = fail)
    → ActionApproved  → state=terminated, done
    → ActionIterate   → pour new wisp, re-dispatch to agent
    → ActionNoConvergence → state=terminated, blocked
    → ActionWaitingManual → human must gc conv approve
```

**ACL enforcement:** agents can only write `convergence.agent_verdict` and
`convergence.agent_verdict_wisp`. All other `convergence.*` keys require a controller token — agents
cannot fake state transitions.

**Exec orders** bypass agents entirely — a shell script runs directly on the controller. Fully
deterministic, no LLM.

### Compared to LangGraph / Temporal

- Like Temporal: the convergence handler is crash-safe and idempotent (speculative-pour-before-commit).
- Unlike LangGraph: there is no Go-level `add_edge(A, B)` for application steps. Step ordering is
  declared in TOML and executed by `bd`'s dependency graph — static, not dynamic code.
- The session reconciler and convergence state machine are code-defined graphs; the intra-molecule step
  DAG is `bd`-managed.

---

## Multi-Feature Concurrent Work

**Three Jira tickets, one repo:**

1. Create a bead per ticket
2. Configure a coder pool with `isolation = "worktree"`
3. Gas City auto-creates a git worktree per agent instance (`.gc/worktrees/<rig>/<agent>/`) on a unique
   branch (`gc/coder-<timestamp>`)
4. Agents work concurrently on separate branches; beads are in the shared rig store
5. Each branch → PR → merge independently; git resolves file conflicts at merge time

**Sub-task breakdown (architect → coder pattern):**

1. Create an epic bead for the ticket (HITL: spend time with an agent decomposing into child beads)
2. Child beads are labelled for the coder pool
3. One coder agent claims the epic, works child beads sequentially in its worktree/branch
4. Separate agents handle other tickets concurrently

**True backlog isolation** (separate bead stores per feature) requires registering each feature worktree
as its own rig — doable, more setup, only needed for truly independent multi-ticket sub-backlogs.

---

## Worktrees: What's Automatic vs. Manual

`isolation = "worktree"` in an agent's config causes Gas City to automatically:
- Run `git worktree add .gc/worktrees/<rig>/<agent>/ -b gc/<agent>-<timestamp>`
- Place a `.beads/redirect` file in the worktree pointing back to the shared rig bead store
- Store `work_dir` in the bead metadata for restart recovery

You do NOT manually run `git worktree add`. The controller handles it.

---

## Bead Store Isolation Notes

- One `.beads/` database per rig directory — strictly enforced
- Worktrees share the parent rig's bead store via `.beads/redirect`
- Two cities registering the same rig path silently share the same bead DB (acknowledged bug, issue #587)
- `dolt_host`/`dolt_port` overrides exist as a manual escape hatch for pointing rigs at different stores
- Concurrent workstreams within one rig: use labels (`pool:feature-a`, `pool:feature-b`) — same DB,
  logically partitioned

---

## Implications for agent-nexus / ralph / run-beads

### Formulas for the TDD pipeline

The run-beads TDD pipeline (test-writing → coding → test-reviewing → verifying → reviewing → fixing →
documenting) maps naturally to a formula:

```toml
[[steps]]
id = "test-writing"
title = "Write failing tests"

[[steps]]
id = "coding"
title = "Make the tests pass"
needs = ["test-writing"]

[[steps]]
id = "test-reviewing"
title = "Review the tests"
needs = ["coding"]

[[steps]]
id = "verifying"
title = "Run the test suite"
needs = ["test-reviewing"]

[[steps]]
id = "reviewing"
title = "Code review"
needs = ["verifying"]

[[steps]]
id = "documenting"
title = "Document the changes"
needs = ["reviewing"]
```

`bd` handles the step ordering via the dependency graph. Each step is a bead that unlocks when the
previous closes. No LLM in the sequencing path.

**The loop** (retry if gate fails) requires Gas City's convergence engine — `bd` alone executes DAGs, not
loops. Until Gas City is adopted, ralph (or an equivalent outer loop) is still needed for this.

### What moves to the deterministic layer

With Gas City:
- Step sequencing → formula `needs` dependencies (TOML, `bd`)
- Pass/fail routing → gate shell scripts (run tests, typecheck, lint)
- Retry loop → convergence engine (Go, deterministic)
- `generate-progress.ts` → largely replaceable by `gc status` / `bd` queries
- Ralph's dispatch table → formula + gate config

### The remaining gap

Cross-repo dependencies (e.g. "don't merge the API until the frontend bead closes") are not natively
supported. Workaround: a `condition` Order that shell-polls the upstream rig's `bd` state.

---

## Community / Maturity

- Version: v1.0.0 (stable, 2026-04-21) — 610 commits in the v0.15.1→1.0.0 sprint
- Language: Go (1.25+)
- `gastownhall/beads` (the `bd` CLI): 23,049 ⭐, 1,510 forks
- Daily commit cadence; team self-hosts using Gas City (highest-signal feedback loop)
- MIT licence
- Active milestones: `1.0+`

---

## Open Issues Relevant to Us

| Issue | Title | Status |
|---|---|---|
| #587 | Multi-city rig and bead-state separation (Pack/City v2) | Open, accepted, no design yet |
| #907 | Hardcoded 'hq' DB name prevents multi-city Dolt sharing | Open, `1.0+` |

[Inspirations](../inspirations.md)
