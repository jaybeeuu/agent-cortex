# Skill Anatomy

This document is the **canonical skill anatomy** for `agent-cortex` skills.
Use it as the source of truth for `SKILL.md` structure, language, and review quality gates.

## Front-matter spec

Required fields:
- `name`: kebab-case skill identifier.
- `description`: max 1024 characters.

Optional fields:
- `argument-hint`: input prompt shown to users at invocation.
- `disable-model-invocation`: for deterministic prompt-injection skills that should not be summarized/interpreted.

## Description format rules

- Target ≤200 characters even though max is 1024.
- Write in third-person declarative voice.
- Sentence 1: what the skill does.
- Sentence 2: starts with `Use when ...`.
- Include 2-4 natural user trigger phrases (quoted) such as "diagnose this" or "something is broken".
- Prefer user vocabulary over internal jargon.

## Voice and tone rules

- Write the body in imperative second-person: "Run X", "Check Y", "Report Z".
- Use positive framing; reserve "do not" only for hard safety/correctness boundaries.
- Add one rationale sentence for non-obvious rules so behavior generalizes in novel cases.
- Avoid ALL-CAPS emphasis.

## Tool references

Reference agent tools by `{{TOOL:name}}` token (canonical copilot name), never a
hardcoded harness-specific name such as `bash`, `task`, or `read_agent` — installers
substitute the per-harness name from `token-map.json` at install time. Add any new tool
to the map's `tools` section in the same change; unknown tokens are hard errors. See
`token-map.README.md` for the full authoring rules.

## Required sections

Every skill must include:
1. `## When to use`
2. `## Workflow` (numbered steps)
3. `## Verification checklist` (`- [ ]` items)

## Optional sections

For each optional section, define **what it is**, include an **example snippet**, and state **when to include** and **when to omit**.

| Section | What it is | Example snippet | When to include | When to omit |
|---|---|---|---|---|
| `When NOT to use` | Explicit out-of-scope invocation boundaries | `- When NOT to use: single-line typo fixes with no process risk.` | Skills with similar neighbors where invocation precision matters | Truly unique one-purpose utility skills |
| `Red Flags` | Detectable anti-patterns the agent should self-correct during execution | `- Red flag: skipping boundary validation to save time.` | Discipline-enforcement skills (security, TDD, review) | Simple utility wrappers |
| `Common Rationalizations` | Excuses models use to skip process with rebuttals | `| "This is small" | Small changes still need invariants checked. |` | Process-critical skills where shortcut pressure is common | Mechanical one-step skills |
| `Philosophy / rationale` | Why the method exists and what trade-offs it protects | `- We front-load validation because downstream rollback cost is higher.` | Opinionated skills expected to handle novel variants | Purely mechanical instructions |
| `Phase-gate checklists` | Mid-workflow gates that must pass before proceeding | `- [ ] Phase 1 complete: baseline tests captured.` | Multi-phase workflows (3+ distinct phases) | Linear single-phase tasks |
| `Cross-skill references` | Explicit delegation to another skill for a real sub-task | `- Run \\`review-security\\` before committing.` | Another skill owns a sub-domain better than restating it | Self-contained skills |
| `Examples` | Full worked sample of expected outcome/output | `- Input: ... Output: ...` | Any non-trivial output contract | Trivially self-evident skills |
| `Workflow diagrams` | Inline ASCII diagram showing step flow and decision points | Fenced block of `[Box]`, `|`, `-`, `>`, `v` arrows, e.g. `[Start] --> [Validate] --> [Run]` | Multi-step or branching workflows where a glanceable flow improves comprehension | Simple linear workflows already clear from numbered steps |

## Workflow diagram style guide

When a skill includes a workflow diagram, follow these rules so it renders
reliably in any CLI:

- **ASCII only** — never Mermaid, images, or unicode box-drawing characters.
  Keep to `|`, `-`, `>`, `+`, and `v`.
- **Fenced block** — wrap the diagram in a fenced code block so monospace is
  preserved.
- **At most 80 characters per line** — narrow enough for terminal-width readers.
- **Short box labels** — imperative verbs or nouns (e.g. `[Validate scope]`),
  never full sentences.
- **Read left-to-right, top-down** — prefer one branch level over dense joins.
- **Mirror the numbered workflow** — the diagram is a glanceable summary of the
  `## Workflow` steps, never a source of truth that contradicts them.

## Section ordering

### When to use

State concrete invocation triggers using natural language phrases users actually type.

### When NOT to use

Place this section immediately after `When to use` whenever present.

### Workflow

Provide ordered, deterministic steps with observable outcomes.

### Verification checklist

Provide completion gates that are testable and stage-scoped.

## File layout and progressive disclosure

- Target ~150 lines for `SKILL.md`.
- Split long docs into purpose-named support files:
  - `EXAMPLES.md` for worked examples.
  - `FORMAT.md` for schemas/templates.
  - `REFERENCE.md` for rare edge cases.
- Use slash-command references when another skill should be invoked.

## Acceptance criteria checklist

A skill passes anatomy review when:
- [ ] Front matter uses required fields and valid description format.
- [ ] Tool references use `{{TOOL:name}}` tokens, not hardcoded tool names.
- [ ] Required sections exist and follow canonical ordering.
- [ ] Optional sections (if present) include what/when/example guidance.
- [ ] Workflow diagrams (if present) are ASCII-only and follow the workflow diagram style guide.
- [ ] Verification checklist contains concrete, machine-checkable items.
- [ ] Supporting docs are split by purpose when `SKILL.md` would exceed ~150 lines.

## Annotated template

```md
---
name: skill-name
description: This skill performs a specific capability. Use when a user asks for a matching workflow such as "triage this", "investigate this", or "prepare a handoff".
argument-hint: Optional prompt shown to users when extra input is needed.
disable-model-invocation: false
---

# Skill Name

## When to use

- Trigger phrases users actually say, e.g. "triage this failure".
- Include 2-4 concrete patterns.

## When NOT to use

- Out-of-scope cases that should route elsewhere.

## Workflow

1. Gather required context and validate scope boundaries.
2. Execute deterministic steps in order, recording key decisions.
3. Produce the required output artifact or terminal response.

Workflow at a glance (include only when the flow branches):

    [Trigger] --> [Gather context] --> [Validate scope]
                                          |
                                     (invalid)
                                          v
                                    [Reject early]
                                          |
                                      (valid)
                                          v
                                [Run deterministic steps]
                                          |
                                          v
                                  [Produce output artifact]

## Red Flags

- Red flag: skipping validation of unknown external input.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "This is too small for process" | Process protects against regressions regardless of size. |

## Philosophy / rationale

- We optimize for explicit boundaries because they reduce rework and improve reliability.

## Phase-gate checklist

- [ ] Phase 1 complete and baseline checks captured.
- [ ] Phase 2 complete and contract validation passed.

## Cross-skill references

- Run `review-security` before committing any externally exposed change.

## Examples

Input: "Investigate this flaky suite"
Output: concise root-cause summary, failing tests list, and next action.

## Verification checklist

- [ ] Output matches requested format.
- [ ] Required tests/lints were run and results recorded.
- [ ] No unrelated files were changed.
```
