# Idea: ctx feedback command for capturing ideas from any machine

## Status
Backlog idea (not implementation-ready)

## Created
2026-09-02

## Problem
Ideas about agent-cortex (and the workflow around it) strike while working on the
work laptop or other machines, where this repo — `docs/ideas/`, the beads tracker,
the skills — is not the project in hand. Those ideas die or wait until back at the
personal dev machine. There is no low-friction path from "idea in my head elsewhere"
into this repo's backlog.

## Who benefits
The author: a capture path that works from any machine with the CLI installed and
no requirement to be inside the repo. Same benefit as the `ctx alias/version/update`
idea — a shared, short command surface on the work machine.

## Proposed outcome
- `ctx feedback` (or `agent-cortex feedback` until the alias exists) opens an
  interactive curated capture: prompt for the idea, one-line summary, optional
  context, and a check against existing issues/parked ideas to avoid duplicates.
- The captured idea lands as a GitHub issue on the agent-cortex repo, tagged with a
  stable label (e.g. `idea`) so it is distinguishable from bug reports/chores.
- Curated, not one-shot: the flow forces the two minutes of thought the
  `record-idea` skill requires, without requiring the skill's local scaffold.
- Something downstream (a session, a manual sweep, or that skill itself) triages
  `idea` issues into `docs/ideas/` records or beads for actual prioritisation.

## Validity check
- Evidence we already have: the author captures ideas regularly at the dev machine
  (`docs/ideas/` has 20+ records, two added today), and explicitly wants a way to do
  that from the work laptop. The `ctx` surface is already planned, so this rides an
  existing idea rather than inventing a new command family.
- Riskiest assumption: the work laptop has working GitHub auth (gh CLI or token) for
  this repo. If it does not, the command needs its own credential story and the
  "from any machine" promise quietly becomes "from any machine with a GitHub token".
- What would invalidate this idea: a second capture surface (issues) that never gets
  triaged into `docs/ideas/` — the repo would then have two idea stores drifting
  apart, and feedback issues would accumulate unread. Also invalidated if the work
  laptop auth friction turns out worse than the original "note it in a scratch file"
  path.

## Constraints
- Must not duplicate the local capture flow — if the author is on the dev machine,
  `record-idea` (a proper record with validity check) stays the canonical path; the
  GitHub issue is the from-anywhere path.
- Duplicate hygiene: the curated step must surface existing `idea` issues before
  creating a new one.
- No new long-lived auth secrets on the work laptop beyond what gh already uses.

## Next validation step
Check, on the work laptop, whether `gh auth status` (or an equivalent token) already
covers the agent-cortex repo. If yes, the idea is implementation-ready — wire
`ctx feedback` to `gh issue create` with the `idea` label. If not, that auth gap is
the real problem to solve first.

## Notes
- Recorded back-to-back with `ctx-alias-version-and-update-commands.md`; sharing the
  `ctx` surface and the P3 priority band.
- Deliberately couples to GitHub issues (not the beads tracker): beads live on the
  dev machine's dolt state, which is the wrong sink for a machine that cannot see
  that state.
- Needs a triage convention: either a periodic beat that converts `idea` issues into
  `docs/ideas/` records, or the record-idea skill grows a "from issue" input mode.