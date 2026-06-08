---
name: maintain-agent-docs
description: "Audit and update AGENTS.md and docs/ to keep agent-consumed documentation accurate, specific, and drift-free. Use when user wants to review, update, or improve AGENTS.md, docs/, or other documentation that agents rely on."
---

# Maintain Agent Docs

Keep AGENTS.md and docs/ accurate, specific, and in sync with the codebase. Also invoke the `style-documentation` skill — its philosophy governs what to document and when.

## When To Use

- After significant codebase changes (new tooling, renamed modules, changed workflows)
- When agents are producing poor results due to stale or missing instructions
- Periodic maintenance — or after major releases
- When onboarding a new repo to agent-assisted workflows

## Process

### 1. Audit

Scan the repository to build a picture of the current state:

- Read existing AGENTS.md (root and any nested copies) and docs/ contents
- Compare instructions against actual codebase: directory structure, runnable commands, conventions, tooling
- Check context budget: is AGENTS.md under 100 lines? Is detail pushed to scoped files?
- Flag issues, grouped by type:
  - **Drift** — instructions that no longer match the codebase
  - **Gaps** — important context missing entirely
  - **Vagueness** — instructions too generic to be actionable
  - **Bloat** — content that belongs in scoped files or docs/, not the root

Present findings as a numbered list. Do NOT fix anything yet.

### 2. Propose changes

For each issue, propose a specific fix. Present all proposals for user review before applying.

### 3. Apply changes

After approval, update files following the quality principles below.

## Context Budget

AGENTS.md is injected into every agent conversation. Every line costs tokens and attention. Research shows bloated context files *reduce* task success while increasing cost 20%+ (ETH Zurich, ICSE 2026). Instructions buried past the first few sections receive significantly less attention ("Lost in the Middle", Stanford).

**AGENTS.md is an index of expensive truths** — only include what the codebase cannot answer on its own. If an agent could infer it by reading the code, it does not belong here.

### Progressive disclosure hierarchy

Not everything belongs in the root file. Push detail to where it's needed:

1. **AGENTS.md** (root) — project-wide truths: what it is, how to build/test/lint, structure overview, hard boundaries. Aim for under 100 lines.
2. **Scoped `.instructions.md`** — path-specific guidance loaded only when the agent works in that area. Use `applyTo` globs to target file types or directories.
3. **docs/** — deeper context (architecture, ADRs, runbooks) that agents can read on demand but shouldn't carry in every conversation.

When auditing, ask: "Does this line resolve an ambiguity that the code alone cannot?" If not, move it down a level or remove it.

## Quality Principles

1. **Specificity over generality** — `npm test -- --coverage` not "run the tests"
2. **Commands up front** — build, test, lint commands in the first section, with exact flags. Position 1 gets the most attention; use it.
3. **Examples over explanations** — one code snippet > one paragraph of prose
4. **Six core areas** — commands, testing, project structure, code style, git workflow, boundaries
5. **Explicit boundaries** — state what agents must NOT do
6. **Tech stack with versions** — "React 18, TypeScript 5.x, Vite" not "a React project"
7. **Drift-resistant** — reference stable concepts (directory purposes, architectural decisions) over volatile details (file lists that change weekly)
8. **Progressive disclosure** — push path-specific or rarely-needed detail into scoped files or docs/, not the root AGENTS.md
9. **No duplication** — reference other docs, don't restate their content
10. **Sparse and maintained** — every line must earn its place; a short accurate file outperforms a comprehensive stale one

## Structure Checklist

A well-maintained AGENTS.md covers:

- [ ] What the project is (one sentence)
- [ ] How to build, test, and lint (exact commands)
- [ ] Project structure (directory map with purposes)
- [ ] Code style and conventions (with examples)
- [ ] Git workflow (branching, commit, PR conventions)
- [ ] Boundaries (forbidden files, actions, patterns)
- [ ] Testing approach (frameworks, coverage expectations)

See [REFERENCE.md](REFERENCE.md) for templates, examples, and detailed section guidance.
