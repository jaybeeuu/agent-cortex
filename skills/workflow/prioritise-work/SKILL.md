---
name: prioritise-work
description: Sets, updates and validates the committed prioritisation strategy that bead scoring ranks against. Use when choosing what to work on next, when the strategy file is missing or stale, or when asked to "set the strategy".
---

# Prioritise Work

Owns one artefact: the **strategy file**, the rubric a scorer reads before it judges a bead's reach, impact, confidence and effort. The skill interviews the owner to write or update it, and validates it before any scorer reads it.

The strategy is a **committed file**, never a bead and never a scratch note. A rubric is reviewed, diffed and versioned as text; a bead carries progress and decisions about *work*, not the durable document that judges work. The tracker convention draws the same line: operational state — progress, decisions, refs — goes in the bead trail, and a document a reviewer diffs stays a file. Keep the strategy a file even when a bead could hold the same words, because then nobody can review a change to the rubric.

## When to use

- "What should I work on next?" — and there is no strategy file, or the one there is predates the current month.
- "Set the strategy", "update the priorities", "we are optimising something else this month".
- A scorer reports a score with no `strategyVersion`, or with one older than the file's.
- Before ranking a backlog: the rubric has to be valid first.

## When NOT to use

- Shaping one feature — use `plan`; that skill scopes a feature, this one orders the work.
- Recording an idea for later — use `record-idea`.
- Tracker questions, or where a bead's state lives — use `bd-tool`.
- Writing a PRD or a design document — use `write-a-prd`.

## The strategy file

| Item | Value |
|---|---|
| Default path | `.agent-cortex/working-docs/strategy.md`, relative to the repository root |
| Override | `--file <path>` on every subcommand |
| Contents | a version integer, a date, and five required sections |
| Lifetime | committed; edited by interview, then versioned with `bump` |

The working-docs root is the scratch directory the HITL handoff also uses: `.agent-cortex/working-docs/hitl/<bead-id>/handoff.md`. The strategy sits beside it and is the one file in that directory the repository commits.

The default path resolves against the **repository root**, found by walking up for a `.git` entry, not against the directory the shell is in. Run `init` from any subdirectory and you still get the one strategy the repository owns. An override behaves differently: a relative `--file` resolves against the current directory, and an absolute one is taken as given.

That directory's contents are usually ignored (`working-docs/*`), so track the strategy explicitly. Add the un-ignore line to the consuming repository's `.gitignore` once:

```gitignore
!.agent-cortex/working-docs/strategy.md
```

Use that rather than `git add -f`: an ignored file disappears from `git status`, so the next update is committed by nobody.

## Workflow

### First run — no strategy file

1. Confirm the file is absent:

```bash
node <skill-scripts>/strategy.mjs validate
```

It exits 1 and names the path it looked for. Do not search the repository for an alternative: one strategy, one location, or two scorers rank against two rubrics.

2. Write the shipped template to that path. This is the copy step — the script resolves its own template, so it works from either install layout:

```bash
node <skill-scripts>/strategy.mjs init
```

It stamps the date and leaves the version at `1`, and refuses to overwrite an existing file.

3. Interview the owner. Ask one question at a time and write the answer under the section the table below names. Replace the guidance comment with the owner's own words; do not paraphrase a figure they gave.

4. Validate before committing. `validate` prints the filled rubric to stdout only when it passes, and names every defective field or section on stderr otherwise:

```bash
node <skill-scripts>/strategy.mjs validate
```

5. Commit the file with the un-ignore line. The interview is finished only when `validate` exits 0 and `git ls-files --error-unmatch .agent-cortex/working-docs/strategy.md` succeeds.

### Later runs — the file exists

6. Read the current strategy and check its `**Updated:**` date. A date from an earlier month is stale: re-run the interview before scoring anything against it.

7. Ask the four questions again, plus the confidence question, and edit the sections that changed. Leave a section alone when the answer has not changed.

8. Bump the version and record the date, then validate:

```bash
node <skill-scripts>/strategy.mjs bump
```

The bump refuses a file that is not already valid, raises the version by exactly one, and writes today's date in UTC. Report the old and new version to the owner.

9. Commit the file. The version is what a score's `strategyVersion` points at, so a bump with no commit leaves scores pointing at a rubric nobody else has.

### Interview questions

One question produces one section. Ask them in this order; each answer is one to four lines.

| Ask | Write into |
|---|---|
| What are you optimising this month? Name the outcome, not the feature. | `## Current themes` |
| What must a bead change to be worth doing now? | `## What counts as value` |
| When should a score be distrusted — which evidence is missing? | `## How to judge confidence` |
| What are you deliberately not doing this month, however good it looks? | `## Explicitly out of scope` |
| How long did comparable work take recently? Anchor the effort scale to it. | `## How to calibrate effort` |

The confidence question matters as much as the other four: effort and impact estimates are judgements, and the strategy is the only place the owner states how far to trust one.

## The script

One script, three subcommands, zero dependencies, no tracker access. It reads and writes the strategy file and calls nothing else, so no run creates, tags or closes a bead.

| Command | Behaviour | Exit |
|---|---|---|
| `init` | Writes the template, stamped with today's date; refuses an existing file | 0 written, 1 refused |
| `validate` | Checks the version integer, the date, and every required section; prints the file to stdout when valid | 0 valid, 1 invalid |
| `bump` | Refuses an invalid file, raises the version by one, records today | 0 bumped, 1 refused |

`validate` splits its output: status and errors go to stderr, the rubric goes to stdout. `validate > rubric.md` captures the rubric alone, which is how a scorer loads it. A failing run names the file and lists one line per defect, so one fix round clears the whole file.

The date is checked as a **calendar** date, not as a shape. `2026-02-31` and `2026-04-31` fail in both `validate` and `--today`, because V8's ISO parser rolls them into the next month and accepts them; `2024-02-29` passes and `2026-02-29` does not. A rolled date records a change on a day it did not happen.

Exit code 2 means a malformed call — an unknown subcommand or a bad `--today`. `--today YYYY-MM-DD` exists so a test pins the recorded date; a person accepts the default.

## Hand edits and forgotten bumps

A hand edit that changes a section but forgets `bump` still passes `validate`: the shape is intact, so nothing can tell the content moved. The version then understates the change, and a score recorded against the old version looks current.

Validate catches shape, not intent. The protection is the version a score records: a scorer stores the `strategyVersion` it scored against, so a reader compares the two numbers and re-scores when they differ. Always finish an edit with `bump`, and never hand-raise the version.

## Red Flags

- Red flag: moving the strategy into a bead, a label or a scratch file because it is "just a rubric".
- Red flag: editing a strategy and skipping `bump`, so the recorded version hides the change.
- Red flag: copying the template and leaving a guidance comment in place of an answer.
- Red flag: scoring against a file whose `validate` was never run — a malformed rubric scores silently.

## Verification checklist

- [ ] `node <skill-scripts>/strategy.mjs validate` exits 0 and printed the rubric.
- [ ] Every section carries the owner's words, not the template's comment.
- [ ] The version is one higher than the previous file for an update, or `1` for a new one.
- [ ] `git ls-files --error-unmatch .agent-cortex/working-docs/strategy.md` succeeds.
- [ ] No bead was created, tagged or closed by this skill.

## See Also

- [plan](../../workflow/plan/SKILL.md) — shapes one feature into beads; this skill orders the beads that exist.
- [bd-tool](../../productivity/bd-tool/SKILL.md) — where operational state lives, and why a durable document does not belong there.
- [hitl-collab](../../workflow/hitl-collab/SKILL.md) — the handoff document that shares the working-docs root with the strategy.
