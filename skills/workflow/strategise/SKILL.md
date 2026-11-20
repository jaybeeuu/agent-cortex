---
name: strategise
description: Sets, updates and validates the committed prioritisation strategy that bead scoring ranks against. Use when the strategy file is missing, stale or disputed, or when asked to "set the strategy".
---

# Strategise

Owns one artefact: the **strategy file**, the rubric a scorer reads before it judges a bead's reach, impact, confidence and effort. The skill opens by summarising the file, interviews the owner to write or update it, and validates it before any scorer reads it.

This skill does not score a bead and does not rank a backlog. `score-bead` records a RICE score against this rubric, and `hitl-queue` prints the order; [prioritise](../prioritise/SKILL.md) is the sequence that runs both and the guard that stops them on a bad file.

The strategy is a **committed file**, never a bead and never a scratch note. A rubric is reviewed, diffed and versioned as text; a bead carries progress and decisions about *work*, not the durable document that judges work. The tracker convention draws the same line: operational state — progress, decisions, refs — goes in the bead trail, and a document a reviewer diffs stays a file. Keep the strategy a file even when a bead could hold the same words, because then nobody can review a change to the rubric.

## When to use

- "Set the strategy", "update the priorities", "we are optimising something else this month".
- The order looks wrong and the rubric behind it predates the current month.
- "This should be higher", "that is not the priority" — a challenge to the order, which is a strategy signal. See [CHALLENGE.md](CHALLENGE.md).
- A scorer reports a score with no `strategyVersion`, or with one older than the file's.

## When NOT to use

- Scoring one bead, or ranking the queue — use [prioritise](../prioritise/SKILL.md).
- Shaping one feature — use `plan`; that skill scopes a feature, this one judges the work.
- Recording an idea — use `record-idea`; where a bead's state lives — use `bd-tool`.

## The strategy file

| Item | Value |
|---|---|
| Default path | `.agent-cortex/working-docs/strategy.md`, relative to the repository root |
| Override | `--file <path>` on every subcommand |
| Contents | a version integer, a date, five required sections, and an optional `## Deadline tiers` table |
| Daily line | one `- daily: <scope>, <scope> — <why>` bullet under `## Current themes` |
| Lifetime | committed; edited by interview, then versioned with `bump` |

The working-docs root is the scratch directory the HITL handoff also uses: `.agent-cortex/working-docs/hitl/<bead-id>/handoff.md`. The strategy sits beside it and is the one file in that directory the repository commits.

The default path resolves against the **repository root**, found by walking up for a `.git` entry, not against the directory the shell is in. Run `init` from any subdirectory and you still get the one strategy the repository owns. An override behaves differently: a relative `--file` resolves against the current directory, and an absolute one is taken as given.

That directory's contents are usually ignored (`working-docs/*`), so track the strategy explicitly. Add the un-ignore line to the consuming repository's `.gitignore` once:

```gitignore
!.agent-cortex/working-docs/strategy.md
```

Use that rather than `git add -f`: an ignored file disappears from `git status`, so the next update is committed by nobody.

**One strategy, one workspace.** A rubric answers the question "what is worth doing here", so each bd workspace carries its own. The HITL queue reads several scopes at once; the **personal** scope's strategy is therefore also where the daily line lives, and the queue quotes it above the ranked list to say which scope the day belongs to. Write it under `## Current themes`, name the scopes first, then an em dash and the reason. `validate` does not require it: a strategy with no daily line is valid, and the queue says the note is missing rather than inventing one.

## Step one — summarise what is already there

A run never opens with a question. Run the summary first: it reads the committed file, so it cannot describe a strategy that is not on disk, and it shows the owner what they are about to edit.

```bash
node <skill-scripts>/strategy.mjs summary
```

The digest is all it prints: the path it read, the version, the newest change-log entry, the themes, the two admissibility lists as up to two bullets each, and — when the file states a table — the deadline factors in the order the queue applies them. It is not a re-print — open the file for what a cut line left out.

| Exit | The file | What to do |
|---|---|---|
| 0 | valid | Show the digest, then ask "what should change?" |
| 3 | absent | Say there is no strategy yet and take the first-run interview below. Print no digest. |
| 1 | invalid or partly missing | Never present it as current. Say what it named — the empty or missing section, the field it could not read — and fix the file or re-interview before anything is scored against it. |

**The file gains no new section.** An admissibility heading would fail every strategy already committed, because `validate` gates them all. The file says what is worth doing and what is not: `## Current themes` is what the month is for, `## What counts as value` is the test a bead must pass, and `## Explicitly out of scope` is the work the month rules out — the last two are the digest's **admissibility** lines. What orders the beads that pass them is the **scoring rubric**, RICE with its multipliers, never this file. The one ordered rule set the file states is `## Deadline tiers`, and the digest prints its rows narrowest first whatever order the file holds them in; with no table the documented default applies and the digest says nothing about deadlines.

## Workflow

### First run — no strategy file

1. The summary exited `3`: the file is absent. Do not search the repository for an alternative — one strategy, one location, or two scorers rank against two rubrics.

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

6. The summary is step one above, so the version and the last change are already in front of the owner. A last change from an earlier month is stale: re-run the interview before scoring anything against it.

7. Ask the four questions again, plus the confidence question, and edit the sections that changed. Edit the deadline-tier table too when a due date should move a rank further or sooner.

8. Bump the version and record the date and the reason, then validate:

```bash
node <skill-scripts>/strategy.mjs bump --reason "<why the rubric changed>"
```

The bump refuses a file that is not already valid and refuses an empty reason, raises the version by exactly one, writes today's date in UTC, and appends `- <date> v<n>: <reason>` to the change log. Report the old and new version to the owner.

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

## Hand edits and forgotten bumps

A hand edit that changes a section but forgets `bump` still passes `validate`: the shape is intact, so nothing can tell the content moved. The protection is the version a score records — a scorer stores the `strategyVersion` it scored against, so a reader compares the two numbers and re-scores when they differ. The change log closes the rest of the gap: `validate` fails when its newest line names a version the header does not, so a raised version with no recorded reason is caught.

## Red Flags

- Red flag: moving the strategy into a bead, a label or a scratch file because it is "just a rubric".
- Red flag: editing a strategy and skipping `bump`, or hand-raising the version, so the record hides the change.
- Red flag: editing a score to satisfy a challenge, instead of changing the rubric that produced it.
- Red flag: scoring against a file whose `validate` was never run — a malformed rubric scores silently.

## Verification checklist

- [ ] The run opened with the digest — file, version, last change, themes, admissibility, deadline factors — before it asked anything, and `node <skill-scripts>/strategy.mjs validate` exits 0 with the rubric printed.
- [ ] The version is one higher than the previous file for an update, or `1` for a new one, and the change log names it.
- [ ] A challenged order moved only after a bump, and the record names what moved.
- [ ] No bead was created, tagged or closed by this skill; `git ls-files --error-unmatch .agent-cortex/working-docs/strategy.md` succeeds.

## See Also

- [CHALLENGE.md](CHALLENGE.md) — the sequence, the refusals and the no-change path when the order is challenged.
- [REFERENCE.md](REFERENCE.md) — every subcommand, what it prints, and the exit codes that tell a first run from an invalid strategy.
- [prioritise](../prioritise/SKILL.md) — the score-then-rank sequence, and the guard that refuses it on an invalid strategy.
- [plan](../../workflow/plan/SKILL.md) — shapes one feature into beads; this skill judges the beads that exist.
- [bd-tool](../../productivity/bd-tool/SKILL.md) — where operational state lives, and why a durable document does not belong there.
