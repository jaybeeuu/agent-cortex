# Skill Usage Audit: session-transcript scan

This is a promoted research note.

> Source: a local scan of pi session transcripts on the author's machine
> Scanned: 668 session files, 231 MB, 2026-05-25 to 2026-11-14
> Captured: 2026-11-14. Operational record: bead `agnt-ctx-k8sw`.

## Why this note exists

The shipped `skill-stats` extension could not answer "how has my skill usage changed over
months". `~/.pi/agent-cortex/skill-usage.json` kept `recentEvents` as a 200-event ring —
about seven minutes of history — and the per-skill counters carried only a `lastUsed`
timestamp. A longitudinal answer therefore required a one-off scan of the session
transcripts.

That scan is not reproducible on demand, and the daily rollups that now ship
(`skill-usage-daily.json`, retained 365 days) start from the day they were installed. They
hold no history before that date, and they report older buckets as unavailable rather than
invent them. This note is therefore the only baseline for the period before the rollups
existed.

## Method

Count `read` tool calls whose path matches `skills/<group>/<name>/SKILL.md`, then bucket the
sessions by the month in the session file name and group by skill name. 1,586 events in
total.

## Findings — monthly

| Month | Sessions | Skill reads | Distinct skills | Reads/session | Top skills |
|---|---|---|---|---|---|
| 2026-06 | 62 | 174 | 24 | 2.8 | ralph, git-workflow, plan |
| 2026-07 | 29 | 49 | 15 | 1.7 | bd-tool, ralph, create-task |
| 2026-08 | 85 | 259 | 23 | 3.0 | git-workflow, using-agent-skills, bd-tool |
| 2026-09 | 102 | 355 | 23 | 3.5 | classify-bead, git-workflow, style-tests |
| 2026-10 | 340 | 649 | 30 | 1.9 | design-an-interface, git-workflow, ralph |
| 2026-11 (to 14th) | 40 | 100 | 14 | 2.5 | design-an-interface, ralph, classify-bead |

## Findings — recent weeks

Peaks: 2026-W41 336 reads (`design-an-interface` 257), 2026-W44 186 (`design-an-interface`
78), 2026-W35 112 (`git-workflow` 18), 2026-W36 115 (`git-workflow` 21, `grill-with-docs`
20).

## Interpretation

- October is an orchestration artefact, not a habit change. Sessions tripled while reads per
  session fell to 1.9, which is what many short ralph worker sessions look like.
- The repertoire widened to 30 distinct skills in October, then narrowed to 14 by
  mid-November.
- The centre of gravity moved from `ralph`, `plan` and `git-workflow` (June to August) to
  `classify-bead` and the `style-*` set (September) to `design-an-interface` and `ralph`
  (October and November).
- A weekly read spike is one session re-reading a skill, not many distinct decisions. Read
  counts measure attention, not breadth of use.

## Caveats on the method

- The count covers `read` tool calls to `skills/<group>/<name>/SKILL.md` only. `/skill:name`
  invocations and inline loads are invisible to it, and a flat Claude Code install uses a
  different path shape, so those reads are missed.
- Sessions are bucketed by the month in the session file name, and worktree sessions live in
  their own directories.
- The same data also tracks skills installed by other packages (beads, ctx-*, gc-*, librarian
  and others). Any pruning decision must filter to the skills this repository ships.

## Decision that followed

Option 1 from the audit was taken: keep low-fidelity per-day rollups for a year and add a
`timeline` view, so a trend is one command and the storage stays bounded. That work landed
under bead `agnt-ctx-rhzo` (commit `e1f5768`) and is described in
`extensions/skill-stats/README.md`.

The two alternatives were not taken. Shipping a reusable transcript-scan script would make a
231 MB private corpus part of a shipped command, and a hot/cold pruning split depends on
usage data from outside this repository, so it stays a decision for the author rather than a
change to the skills.
