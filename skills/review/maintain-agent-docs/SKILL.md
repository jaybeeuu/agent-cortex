---
name: maintain-agent-docs
description: Audits and updates AGENTS.md and docs/ to keep agent-consumed documentation accurate, specific, and drift-free. Use when asked to "review AGENTS.md", "check the docs are current", or "fix docs drift".
---

# Maintain Agent Docs

## When to use

- After significant codebase changes — new tooling, renamed modules, changed workflows — leave agent instructions stale.
- When agents produce poor results due to outdated or missing instructions.
- Periodic maintenance, after a major release, or when onboarding a new repository to agent-assisted workflows.
- Trigger phrases: "review AGENTS.md", "check the docs are current", "fix docs drift", "update the agent docs".

## When NOT to use

- Deciding what to document or whether a doc is needed — `style-documentation` owns that call; this skill applies it during the audit.
- Creating or refactoring a skill — use `write-a-skill` or `refactor-skill`.
- Editing a single doc without auditing the codebase — that is ordinary doc-writing, not maintenance.

## Philosophy / rationale

- **AGENTS.md is an index of expensive truths.** It is injected into every agent conversation, so every line costs tokens and attention. Bloated context files reduce task success while increasing cost (ETH Zurich, ICSE 2026); instructions past the first sections get less attention ("Lost in the Middle", Stanford). Include only what the codebase cannot answer on its own.
- **Progressive disclosure by need.** Root AGENTS.md stays under 100 lines; path-specific `.instructions.md` files load on demand; depth lives in `docs/` read when needed. When auditing, ask: "Does this line resolve an ambiguity that the code alone cannot?" If not, move it down a level or remove it.

## Workflow

### 1. Audit

- Read AGENTS.md (root and any nested copies), scoped `.instructions.md` files, and `docs/` contents.
- Compare instructions against the actual codebase: directory structure, runnable commands, conventions, tooling.
- Check the context budget — is AGENTS.md under 100 lines, with detail pushed to scoped files?
- Flag findings grouped by type: **Drift** (no longer matches), **Gaps** (missing context), **Vagueness** (too generic to act on), **Bloat** (belongs in scoped files or `docs/`). Present them as a numbered list; fix nothing yet.

### 2. Propose changes

For each finding, propose a specific fix. Present every proposal for review before applying anything.

### 3. Apply changes

After approval, update files following the quality principles below. Verify commands by running them; update what changed, prune what drifted.

## Quality principles

1. **Specificity over generality** — `npm test -- --coverage`, not "run the tests".
2. **Commands up front** with exact flags — build, test, lint in the first section; position 1 gets the most attention.
3. **Examples over explanations** — one code snippet beats one paragraph of prose.
4. **Cover six core areas** — commands, testing, project structure, code style, git workflow, boundaries.
5. **Explicit boundaries and tech stack with versions** — what agents must NOT do, with reasons; "React 18, TypeScript 5.x", not "a React project".
6. **Drift-resistant and non-duplicative** — stable concepts (directory purposes) over file lists; reference other docs, do not restate them.
7. **Progressive disclosure, sparse and maintained** — path-specific detail moves into scoped files or `docs/`; every line must earn its place.

See [REFERENCE.md](REFERENCE.md) for templates, examples, and detailed section guidance.

## Red Flags

- **Fixing findings during the audit.** The propose gate exists because the user knows which imperfections are intentional.
- **Adding without pruning.** A new section that does not displace a stale one bloats every conversation.
- **Trusting docs without running the commands.** A command that errors is drift, however plausible it reads.
- **Auditing only the root file.** Nested `.instructions.md` and `docs/` drift just as easily.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I'll just fix this one drift directly" | Bypassing the propose gate skips the user's chance to flag intentional imperfections. |
| "Adding one line is harmless" | Every line costs tokens in every conversation. Sparse accurate beats comprehensive drift. |
| "The commands are obvious" | Obvious to you, guessed wrong by agents. Verify by running them. |
| "More detail helps agents" | Bloated context files measurably reduce task success. |
| "This file is small, it's fine" | Small does not mean current. Only cross-checking against the code reveals drift. |

## Phase-gate checklist

- [ ] Phase 1 complete: audit findings presented as a numbered list; nothing fixed yet.
- [ ] Phase 2 complete: every proposal reviewed and approved before applying.

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| What and whether to document | `style-documentation` |
| Tone, structure, and concision for the writing | `style-comms` |
| Creating or refactoring a skill | `write-a-skill`, `refactor-skill` |
| Scanning changes for leaked secrets | `review-security` |

## Examples

```
Findings:
1. [Drift] AGENTS.md says `pnpm run build` but package.json defines `build:dist`
2. [Gap] New scripts/ directory has no structure entry
3. [Bloat] Lines 40-52 restate README install steps word-for-word
```

## Verification checklist

- [ ] Every agent-consumed doc audited — root AGENTS.md, nested `.instructions.md`, `docs/` — and cross-checked against actual structure, commands, and tooling
- [ ] Findings grouped by drift/gap/vagueness/bloat and presented before any change
- [ ] All changes applied only after approval
- [ ] AGENTS.md under 100 lines; detail pushed to scoped files or `docs/`
- [ ] Commands listed in AGENTS.md verified runnable (build, test, lint)
- [ ] Content passes the "code alone cannot answer this" test — nothing restated or duplicated
- [ ] Changes scanned with `review-security` before committing