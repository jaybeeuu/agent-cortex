# Reference: Maintain Agent Docs

Detailed templates, examples, and anti-patterns for AGENTS.md and docs/ maintenance.

## AGENTS.md Template

```markdown
# AGENTS.md

Instructions for agents working on this repository.

## What This Project Is

[One sentence describing the project's purpose.]

## Commands

[List exact commands agents will need. Put these early — agents perform best when
they know what to run.]

| Task | Command |
|------|---------|
| Install | `npm install` |
| Build | `npm run build` |
| Test (all) | `npm test` |
| Test (single) | `npm test -- --grep "pattern"` |
| Lint | `npm run lint` |
| Type check | `npx tsc --noEmit` |

## Project Structure

[Directory map with purposes. Focus on stable structure, not individual files.]

## Code Style

[Conventions with concrete examples. Show a "good" snippet, not just rules.]

## Testing

[Frameworks, coverage expectations, where tests live, naming conventions.]

## Git Workflow

[Branch naming, commit conventions, PR process.]

## Boundaries

[What agents must NOT do. Be explicit.]

- Never modify files in `vendor/` or `dist/`
- Never commit secrets or credentials
- Never delete migration files
```

## Section-by-Section Guidance

### Commands

The highest-impact section. Put it near the top.

- Include exact flags and options, not just the base command
- Show the single-file variants (e.g. how to run one test, lint one file)
- If commands vary by environment, show a table

**Good:**

```markdown
| Task | Command |
|------|---------|
| Test all | `pytest -v --tb=short` |
| Test one file | `pytest tests/test_auth.py -v` |
| Test with coverage | `pytest --cov=src --cov-report=term-missing` |
```

**Bad:**

```markdown
Run `pytest` to test.
```

### Project Structure

Show what each top-level directory is for. Avoid listing every file — the structure
changes; the purposes don't.

**Good:**

```markdown
src/
├── api/         # HTTP handlers and route definitions
├── domain/      # Business logic, pure functions
├── infra/       # Database, external service clients
└── shared/      # Cross-cutting utilities and types
```

**Bad:**

```markdown
src/
├── api/
│   ├── routes.ts
│   ├── middleware.ts
│   ├── auth.ts
│   ├── users.ts
│   └── ...
```

### Boundaries

Frame as "never" rules. Agents follow prohibitions more reliably than preferences.

- Start each rule with "Never" or "Do not"
- Be specific about paths and actions
- Explain why if the reason isn't obvious

### Code Style

Show, don't tell. A short before/after example communicates more than a list of rules.

**Good:**

```markdown
## Naming

```ts
// ✅ Use descriptive names; Boolean variables start with is/has/should
const isAuthenticated = true;
const hasPermission = checkAccess(user, resource);

// ❌ Avoid abbreviations and generic names
const auth = true;
const flag = check(u, r);
`` `
```

**Bad:**

```markdown
## Naming

- Use descriptive names
- Boolean variables should start with is, has, or should
- Avoid abbreviations
```

## docs/ Organisation

Keep docs/ flat and purpose-driven:

```
docs/
├── architecture.md     # System design, module boundaries, data flow
├── decisions/          # ADRs (Architecture Decision Records)
│   ├── 001-use-postgres.md
│   └── 002-event-sourcing.md
└── runbooks/           # Operational procedures
    ├── deploy.md
    └── incident-response.md
```

- Each file should have one clear purpose
- Prefer updating an existing file over creating a new one
- Link from AGENTS.md into docs/ for detail — don't duplicate

## Anti-Patterns

| Anti-pattern | Why it's harmful | Fix |
|---|---|---|
| **Listing every file** | Goes stale immediately; wastes tokens | Describe directory purposes instead |
| **"Be helpful"** | Too vague to change agent behaviour | Give specific instructions with examples |
| **Duplicating README content** | Two sources of truth that drift apart | Reference README, don't copy it |
| **No commands section** | Agents guess at commands, often wrong | Add exact commands with flags |
| **Aspirational docs** | Describes what you wish the code did | Document current reality only |
| **Monolithic AGENTS.md** | Everything in one file; bloats every conversation | Push detail to scoped files and docs/ |
| **Kitchen-sink instructions** | Agent processes every line, even irrelevant ones | Only include what the code can't answer |
| **Burying critical commands** | "Lost in the Middle" — attention drops with position | Put commands and boundaries first |

## Progressive Disclosure In Practice

### Why it matters

AGENTS.md is loaded into every agent conversation. Benchmarks show:

- Bloated context files reduce task success by 2-3% while increasing inference cost 20%+ (ETH Zurich, ICSE 2026)
- Instructions at position 10 in a config file receive 27% less attention than position 1 (Stanford, "Lost in the Middle")
- Agents process every instruction dutifully — even irrelevant ones — wasting attention budget

**Treat AGENTS.md as a cache for ambiguity resolution**, not a comprehensive manual.

### The three-tier hierarchy

```
Tier 1: AGENTS.md (root)                    ← always loaded
  What the project is, build/test/lint commands, structure overview,
  code style summary, git workflow, hard boundaries.
  Target: under 100 lines.

Tier 2: .instructions.md (scoped)           ← loaded when working in that path
  Path-specific conventions, module-specific boundaries,
  framework-specific patterns.
  Example: src/api/.instructions.md with API-specific conventions.

Tier 3: docs/ (on-demand)                   ← agent reads when needed
  Architecture docs, ADRs, runbooks, detailed design documents.
  Referenced from AGENTS.md but not inlined.
```

### Scoped `.instructions.md` example

```markdown
---
applyTo: "src/api/**"
---

# API Module Instructions

- All handlers return standardised error objects (see docs/architecture.md)
- Use Zod for request validation; never trust raw input
- Integration tests live alongside the handler files as `*.integration.test.ts`
```

### The audit question

For every line in AGENTS.md, ask:

> "Could an agent infer this by reading the code or running a command?"

If yes — remove it. If it only applies to one area — move it to a scoped file. Only what resolves genuine ambiguity earns a place in the root file.

### Sizing guide

| File | Target | Rationale |
|---|---|---|
| AGENTS.md | < 100 lines | Always loaded; every line costs attention |
| Scoped .instructions.md | < 50 lines each | Loaded per-path; keep focused |
| docs/ files | No hard limit | Read on demand; depth is fine |

## Drift Detection Heuristic

When auditing, look for these signals that docs have drifted:

1. **Commands that fail** — try running them; if they error, the docs are stale
2. **Directories that don't exist** — referenced paths that have been renamed or removed
3. **Technologies not in package.json/requirements.txt** — docs mention tools the project no longer uses
4. **Missing new tooling** — project has added linters, formatters, or CI steps not reflected in docs
5. **Contradictions** — AGENTS.md says one thing, a nested .instructions.md says another
