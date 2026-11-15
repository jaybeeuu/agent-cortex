---
name: hitl-queue
description: Ranks the open execution:hitl beads into one list ordered by RICE, transitively blocked dependents and work in progress, and prints what each answer unblocks. Use when deciding which human decision to answer next, when a planning session starts, or when asked "what needs my decision", "show the queue" or "what should I answer first".
---

# HITL Queue

Owns one output: **the ranked list of beads waiting for a human answer**. Each row carries its own arithmetic, so the owner can check *why* one decision outranks another instead of trusting a number.

A queue is not a priority. The RICE score is `score-bead`'s judgement, the band it implies is reviewed there, and this skill only orders beads by a number that already exists. Where no score exists, the queue says so and ranks nothing: inventing an order would hide the gap a person has to fill.

## When to use

- A planning session starts and the owner needs to know which decision comes first.
- "What needs my decision?", "show the queue", "what should I answer first?".
- Before dispatching work from a backlog of HITL beads: the answer unblocks the work, so the order of answers is the order of the work.
- A bead was scored or re-scored and the order should follow the new number.

## When NOT to use

- Judging one bead's components — use `score-bead`. This skill reads a score, it never makes one.
- Writing or bumping the rubric the score rests on — use `prioritise-work`.
- Choosing what to *build* next with an agent — `ralph` drains `execution:afk` beads, and ideas are ranked by `flesh-out-idea`.
- Recording a new idea — use `record-idea`.

## The formula

```
total = rice × (1 + ln(1 + dependents)) × (in progress ? 1.5 : 1)
```

| Term | Meaning |
|---|---|
| `rice` | The stored `score` from the bead's `rice` metadata, written by `score-bead`. Never recomputed here. |
| `dependents` | Distinct beads that wait on this answer, **transitively**. |
| `1.5` | Work in progress outranks equal work not started, so the queue drains WIP first. |

The dependent count is the load-bearing term. A bead blocking A, which blocks B, which blocks C, unblocks **three**. The walk follows `bd dep list <id> --direction up` from bead to bead, and collects **beads, not paths**: when the graph reconverges (a diamond — one bead reached by two routes), it is counted once. Counting paths would measure the shape of the graph instead of the work an answer releases.

Two edges of the walk are deliberate:

- **Only `blocks` edges count.** A related or duplicate edge is not something anyone waits on.
- **The walk passes through every bead; it counts only live ones.** A closed bead is still a link in the chain, so the walk continues past it, but finished work cannot be unblocked, so a closed dependent is not counted.

`1 + ln(1 + n)` is logarithmic on purpose: unblocking thirty chores must not drown the list under one row. Zero dependents scores `1`, so a bead that unblocks nothing is not penalised — it is simply not lifted.

## The report

One flat list, no sections, ranked first and unscored last:

```
HITL decision queue · 2 ranked, 2 unscored · strategy v2
total = rice × (1 + ln(1 + dependents)) × 1.5 in-progress · ties break on rice, then id · unscored last
excluded: 3 kind:idea beads (--include-ideas ranks them)

1  bd-7       10.0  rice 4.2 = R4 · I3 · C0.7 · E2  ×2.39 dependents(3)  ×1.0
    Ship the queue — unblocks bd-8, bd-9, bd-10
2  bd-2        6.3  rice 4.2 = R4 · I3 · C0.7 · E2  ×1.00 dependents(0)  ×1.5 in-progress
    Decide the API shape — unblocks nothing
-  bd-4          —  unscored — no rice metadata (score it with score-bead)
    Decide the vendor — unblocks nothing
```

Every row carries its rank, id, total, the four components the score was computed from, both multipliers, the title, and one clause naming what the answer unblocks. An unscored row keeps its place at the end of the same list with the reason: no `rice` metadata, no score inside a `rice` record, or scored against an older strategy version (that last one is ranked and marked `scored at strategy v1, current v2`).

`--json` prints the same answer with every derived field, for a caller that needs to act on it.

## Ordering rules

- **Ranked by total, descending.** The total is rounded to one decimal *before* ranking, so the number a reader sees is the number the order was decided by.
- **Ties break on rice, then id.** `ln` flattens, so different dependent counts can reach the same one-decimal total; a fixed tie-break means two runs over one backlog print byte-identical output.
- **Unscored beads never earn a rank.** They are listed, not placed, and never compared by title or by priority.

## Workflow

1. **Check the strategy is readable.** The queue compares each score's `strategyVersion` against the file to mark stale scores. A missing or invalid strategy does not stop the run — the scores are already on the beads — but the header then reports `strategy unknown` and no staleness.

```bash
node <skill-scripts>/../../prioritise-work/scripts/strategy.mjs validate
```

2. **Run the queue.** This is the hand-run form: no planner, no agent, one command.

```bash
node <skill-scripts>/queue.mjs queue
```

3. **Report it as printed**, then name the top item plainly: id, title, and what answering it unblocks. Do not group by priority, re-sort, or drop the unscored rows — the flat list is the answer.

4. **Score what is unscored, one bead at a time.** Load `score-bead`, judge the four components against the strategy, and record the score. Re-run the queue; the bead takes its place.

```bash
node <skill-scripts>/queue.mjs queue --json     # the same answer, structured
node <skill-scripts>/queue.mjs queue --file <path> --include-ideas
```

| Option | Effect |
|---|---|
| `--file <path>` | Strategy file. Default `.agent-cortex/working-docs/strategy.md`, relative to the repository root. |
| `--include-ideas` | Rank `kind:idea` beads too. They are excluded by default — see below. |
| `--cwd <dir>` | Directory the strategy path and `bd` resolve from. |
| `--json` | Print the report as JSON. |

`BD_PATH` pins the `bd` binary. The script makes no writes: the tracker calls are `bd list` and `bd dep list`, nothing else.

## What the queue leaves out

- **Ideas, by default.** `kind:idea` beads are HITL by convention but deliberately unshaped: a RICE score on an idea measures a guess about a guess, and the idea backlog is ranked by `flesh-out-idea` instead. An idea that outranks a ripe decision would send the owner into an interview they did not choose. The count is printed so nothing is dropped silently; `--include-ideas` ranks them when the backlog is what the owner is working.
- **Deferred beads.** A deferral is itself an answer, so a parked bead stays out of the queue until the owner lifts it (`bd update <id> --status open`). The count is printed.
- **Closed beads.** Finished work waits on nothing.

## Red Flags

- Red flag: scoring a bead inside this skill, so the queue's order rests on an unreviewed number.
- Red flag: ranking an unscored bead by its priority or its title, so the list looks complete and hides the gap.
- Red flag: counting dependency paths instead of distinct beads, so a diamond inflates one row above its real value.
- Red flag: re-sorting or grouping the flat list before reporting it, so the order the owner reads is not the order that was computed.
- Red flag: excluding ideas without printing how many were excluded.

## Verification checklist

- [ ] The report is one flat list: ranked rows first, unscored rows last, no sections.
- [ ] Each row shows the rank, id, total, the four components, both multipliers, the title and what the answer unblocks.
- [ ] A bead blocking three others ranks above an equal bead blocking none; an in-progress bead ranks above an equal not-started one.
- [ ] With no scores, the header says nothing can be ranked and every candidate is listed unscored with a reason.
- [ ] Two identical runs printed byte-identical output.
- [ ] The excluded idea and deferred counts were reported, or the header said there were none.

## See Also

- [score-bead](../score-bead/SKILL.md) — owns the `rice` record this queue reads, and the band proposal.
- [prioritise-work](../prioritise-work/SKILL.md) — owns the strategy file and its version.
- [bd-tool](../../productivity/bd-tool/SKILL.md) — the tracker commands, and where operational state lives.
- [hitl-collab](../hitl-collab/SKILL.md) — the handoff document for a decision that needs more than an answer.
