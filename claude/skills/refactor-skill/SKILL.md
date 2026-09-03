---
name: refactor-skill
description: Refactor an existing SKILL.md to the canonical anatomy template through template comparison, user interview, and one-pass rewrite. Use when refactoring, restructuring, or reviewing skills, or comparing a skill to the current template.
---

# Refactor Skill

## When to use

- A skill's SKILL.md predates the anatomy template and needs upgrading.
- You want to align a skill with `docs/skills/skill-anatomy.md` before the refactor wave touches it.
- You want to compare a skill's structure to the current template standard.
- Trigger phrases: "refactor this skill", "restructure this skill", "review this skill", "upgrade X to the template", "align with anatomy".

## When NOT to use

- Creating a brand-new skill from scratch — use `write-a-skill` instead.
- Minor copy-editing or typo fixes that don't need anatomy alignment.
- Skills that are already verified against the anatomy template.

## Workflow

### 1. Gather materials

Read the target skill's `skills/<name>/SKILL.md` and the canonical anatomy reference:

```bash
cat skills/<name>/SKILL.md
cat docs/skills/skill-anatomy.md
```

If the target has no `SKILL.md` yet, abort — this skill upgrades existing files; use `write-a-skill` for new creation.

### 2. Compare against the template

Run through each dimension of the anatomy template and record how the target currently relates to it. For each dimension, note the current state — whether it's present, missing, partial, or needs adjustment:

- **Front matter**: `name` and `description` present? Description follows the two-sentence format (capability statement + `Use when ...` with 2-4 trigger phrases)?
- **When to use**: present? Trigger phrases included?
- **When NOT to use**: present? When to include vs omit? Only include if the skill has similar neighbours where invocation precision matters.
- **Workflow**: ordered deterministic steps with observable outcomes?
- **Red Flags**: present? Only include for discipline-enforcement skills (security, TDD, review).
- **Common Rationalizations**: present? Only include for process-critical skills where shortcut pressure is common.
- **Phase-gate checklists**: present? Only include for multi-phase workflows (3+ distinct phases).
- **Cross-skill references**: present? Only include when another skill owns a sub-domain better than restating.
- **Examples**: present? Only include for non-trivial output contracts.
- **Verification checklist**: present? Concrete, machine-checkable items?
- **Voice/tone**: imperative second-person? Positive framing? Rationale sentences for non-obvious rules?
- **Line length**: near ~150 lines? Under 150 hard cap?

The framing is **comparison, not gap detection** — a dimension may already be fully aligned. Build a structured assessment grouped by required vs optional. See `EXAMPLES.md` for the output shape.

#### Phase gate: comparison complete

- [ ] Required dimensions checked (front matter, When to use, Workflow, Verification checklist)
- [ ] Optional dimensions noted as relevant or not for this skill
- [ ] You can articulate what will change and what will stay the same

### 3. Present findings and propose changes

Share the full comparison assessment with the user. Do not start editing yet — this step is about understanding and agreement.

Present the comparison and discuss optional sections using the inclusion criteria below. For opted-in sections, capture content requirements; for opted-out, record the decision. Do not ask about required sections (When to use, Workflow, Verification checklist).

| Section | Ask if |
|---|---|
| `When NOT to use` | The skill has similar neighbours where invocation precision matters |
| `Red Flags` | The skill enforces process discipline (security, TDD, review) |
| `Common Rationalizations` | The skill is process-critical where shortcut pressure is common |
| `Phase-gate checklists` | The workflow has 3+ distinct phases |
| `Cross-skill references` | Another skill owns a sub-domain the workflow delegates to |
| `Examples` | The output contract is non-trivial (formats, schemas, templates) |
| `Philosophy / rationale` | The skill defends an opinionated method with trade-offs |

Then **propose the plan**: summarise what will change, what will stay the same, and the proposed new description. Ask for explicit approval before any file is written — iterate on the proposal if needed.

#### Phase gate: plan approved

- [ ] Comparison and optional-section discussion presented
- [ ] Proposed changes + new description shown to user
- [ ] User explicitly approved the plan

### 4. Produce the rewrite

Write the complete new `skills/<name>/SKILL.md` in one pass covering:

- Correct front matter
- All required sections in canonical order
- Each opted-in optional section with its what/when/example guidance inline
- Voice and tone per `style-code` (imperative second-person, positive framing, rationale sentences)
- Description matching the two-sentence format with 2-4 trigger phrases

Write the file directly:

```bash
cat > skills/<name>/SKILL.md << 'EOF'
<new content>
EOF
```

### 5. Validate against template constraints

After writing, verify:

- [ ] Front matter has `name` and `description`
- [ ] Description is ≤ 1024 chars, two sentences, second starts with "Use when"
- [ ] Required sections present: `## When to use`, `## Workflow`, `## Verification checklist`
- [ ] All opted-in optional sections present in canonical order
- [ ] `SKILL.md` ≤ 150 lines (`wc -l skills/<name>/SKILL.md`)
- [ ] Body uses imperative second-person, positive framing
- [ ] No ALL-CAPS emphasis
- [ ] Rationale sentences present for non-obvious rules

Report any validation failures and fix them. If all pass, summarise what was changed.

## Examples

See `EXAMPLES.md` for a worked comparison table showing the template-comparison output shape for a typical skill refactor.

## Red Flags

- **"I already know this skill"** — Reading the file fresh reveals assumptions that familiarity hides. A skill you use daily may still have front-matter omissions or tone drift. Always read it.
- **Deciding optional sections without asking** — Optional sections depend on the skill's neighbours and purpose, which the user understands better than an agent. Making the call unilaterally produces a weaker result.
- **Keeping old phrasing because "it was already fine"** — Voice and tone rules (imperative second-person, positive framing, rationale sentences) are hard to apply incrementally. Old phrasing that reads fine in isolation may break template consistency.
- **Cargo-culting section headings** — Copying section headings from the template without adapting content to the skill's actual purpose creates generic, low-value sections. Each section must earn its place with specific, skill-relevant content.
- **Refactoring for its own sake** — If the comparison shows the skill is already well-aligned, don't change it. Adding churn for its own sake degrades clarity and wastes time. Report that no changes are needed and stop.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "This skill is already close enough — I'll just tweak a few lines" | Partial alignment creates drift. The template enforces section ordering, tone, and description rules that are hard to apply incrementally. Do the full pass. |
| "The comparison takes too long — I can spot the issues from reading" | The comparison checklist ensures nothing is missed. Skipping it trades thoroughness for speed and usually misses something. |
| "I know what optional sections they'll want" | You might be right, but the user still needs to confirm. Presenting a recommendation with your reasoning is fine — deciding without asking isn't. |

## Verification checklist

- [ ] Target skill's `SKILL.md` exists and was read
- [ ] Template comparison completed before any rewrite
- [ ] Phase gates passed: comparison complete, plan approved
- [ ] User interviewed on every optional section and approved the plan
- [ ] Rewrite includes all required sections in canonical order
- [ ] Rewrite includes opted-in optional sections with guidance
- [ ] Description follows two-sentence format with trigger phrases
- [ ] `SKILL.md` ≤ 150 lines
- [ ] Voice/tone matches `style-code` / `style-documentation` standards
- [ ] No red flags triggered during execution
- [ ] Validation completed and all checks pass
