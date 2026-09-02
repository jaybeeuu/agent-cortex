---
name: write-a-skill
description: "Create new agent skills with canonical anatomy, progressive disclosure, and reusable helpers. Use when the user says \"write a skill\", \"create a skill\", \"make me a skill\", or \"new skill\"."
---

# Write a Skill

## When to use

- The user asks to create a brand-new skill from scratch.
- The user says "write a skill", "create a skill", "make me a skill", or "new skill".
- A new capability needs to be packaged as a reusable skill with a deterministic workflow.

## When NOT to use

- Refactoring an existing skill to the anatomy template — use `refactor-skill` instead.
- Minor copy-editing or typo fixes that do not need a full creation workflow.
- Skills that are not intended to be reusable (one-off scripts, ad-hoc instructions).

## Workflow

### 1. Gather requirements

Clarify the skill goal with the user. Ask what triggers users would actually say, what output the skill produces, and whether any deterministic helper scripts are needed.

### 2. Draft from the anatomy template

Read `docs/skills/skill-anatomy.md` as the source of truth. Follow the annotated template for section ordering and front-matter fields. Target ~150 lines for `SKILL.md` but stay under the 150-line hard cap. When the workflow branches or has decision points, include one inline ASCII workflow diagram per the anatomy doc's diagram style guide — ASCII only, never Mermaid.

### 3. Apply voice and tone rules

Write the body in imperative second-person: "Run X", "Check Y", "Report Z". Prefer positive framing over prohibitions. Add a one-sentence rationale for any non-obvious rule so the model can generalise from it. Avoid ALL-CAPS emphasis.

### 4. Define front-matter fields

Required: `name` (kebab-case), `description` (two sentences, second starts with "Use when", includes 2-4 quoted trigger phrases). Optional: `argument-hint`, `disable-model-invocation` when the skill requires them.

### 5. Split supporting docs when appropriate

Move long examples to `EXAMPLES.md`, output formats to `FORMAT.md`, and infrequently-needed edge cases to `REFERENCE.md`. Keep `SKILL.md` focused on the primary workflow.

### 6. Run the review checklist

Verify the final document against the verification checklist below before finishing.

## Red Flags

- **Writing without reading the anatomy template first** — The template defines section ordering, voice rules, and inclusion criteria for optional sections. Guessing leads to drift.
- **Padding sections with generic content** — Every section must earn its place with content specific to the skill's purpose. Copying generic filler from the template placeholder text produces a weak skill.
- **Skipping the trigger-phrase interview** — The description's trigger phrases are the main routing signal for the skill. Guessing what users say rather than asking produces a skill that is hard to invoke.

## Cross-skill references

- Use `refactor-skill` when the task is upgrading an existing skill rather than creating a new one.
- Run `style-code` after writing to check that code conventions in any example snippets or bundled scripts are consistent.
- Run `review-security` before committing to check for leaked secrets in examples or documentation.

## Examples

Input: "Write a skill that scans git diffs for secrets"
Output: A new `skills/review-security/SKILL.md` with front matter, When to use, Workflow, and Verification checklist following the anatomy template.

## Verification checklist

- [ ] `docs/skills/skill-anatomy.md` was read before drafting
- [ ] Required sections present: `## When to use`, `## Workflow`, `## Verification checklist`
- [ ] Section order follows the anatomy template
- [ ] Workflow diagram (if present) is ASCII-only and follows the anatomy diagram style guide
- [ ] Description uses two-sentence format with 2-4 quoted trigger phrases
- [ ] Body uses imperative second-person voice with positive framing
- [ ] Rationale sentences added for non-obvious rules
- [ ] No ALL-CAPS emphasis
- [ ] `SKILL.md` ≤ 150 lines (`wc -l skills/<name>/SKILL.md`)
- [ ] Supporting docs split by purpose when `SKILL.md` exceeds ~150 lines
- [ ] Cross-skill references point to `refactor-skill` for upgrades where relevant
