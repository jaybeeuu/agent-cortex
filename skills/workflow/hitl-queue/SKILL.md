---
name: hitl-queue
description: Ranks the open execution:hitl beads across every configured bd workspace into one list ordered by RICE, transitively blocked dependents, work in progress and the time left to each due date, prints what each answer unblocks and which scope each row came from, notes which scope the day belongs to, presents the first ten rows as one ranked list with the top row marked as the recommendation, and states what that list left out. Use when deciding which human decision to answer next, when a session cold-starts and must say one item, when a planning session starts, or when asked "what needs my decision", "show the queue", "what should we look at" or "what should I answer first".
---

# HITL Queue

Owns one output: **the ranked list of beads waiting for a human answer**, read from every configured workspace and tagged with the scope each row came from. Each row carries its own arithmetic, so the owner can check *why* one decision outranks another instead of trusting a number.

A queue is not a priority. The RICE score is `score-bead`'s judgement, the band it implies is reviewed there, and this skill only orders beads by a number that already exists. Where no score exists, the queue says so and ranks nothing: inventing an order would hide the gap a person has to fill.

## When to use

- A planning session starts and the owner needs to know which decision comes first.
- "What needs my decision?", "show the queue", "what should I answer first?".
- "What should we look at?" — a cold start that opens with the queue's first ten rows, one line each, the top row marked as the recommendation. See [RECOMMEND.md](RECOMMEND.md).
- Before dispatching work from a backlog of HITL beads: the answer unblocks the work, so the order of answers is the order of the work.
- A bead was scored or re-scored and the order should follow the new number.

## When NOT to use

- Judging one bead's components — use `score-bead`. This skill reads a score, it never makes one.
- Writing or bumping the rubric the score rests on — use `strategise`.
- Choosing what to *build* next with an agent — `ralph` drains `execution:afk` beads, and ideas are ranked by `flesh-out-idea`.
- Recording a new idea — use `record-idea`.

## The formula

```
total = rice × (1 + ln(1 + dependents)) × (in progress ? 1.5 : 1) × deadline × theme
```

| Term | Meaning |
|---|---|
| `rice` | The stored `score` from the bead's `rice` metadata, written by `score-bead`. Never recomputed here. |
| `dependents` | Distinct beads that wait on this answer, **transitively**. |
| `1.5` | Work in progress outranks equal work not started, so the queue drains WIP first. |
| `deadline` | The strategy's tier factor for the time left until the bead's `--due`; `1` when it has no due date. |
| `theme` | `decay ^ served(theme)` over the last `window` real-item closes; `1` for a theme nothing closed in. |

The dependent count is the load-bearing term. A bead blocking A, which blocks B, which blocks C, unblocks **three**. The walk follows `bd dep list <id> --direction up` from bead to bead, and collects **beads, not paths**: when the graph reconverges (a diamond — one bead reached by two routes), it is counted once, because counting paths would measure the shape of the graph instead of the work an answer releases.

Two edges of the walk are deliberate: only `blocks` edges count, because a related or duplicate edge is not something anyone waits on; and the walk passes through every bead while counting only live ones, because a closed bead is still a link in the chain but finished work cannot be unblocked. `1 + ln(1 + n)` is logarithmic on purpose: unblocking thirty chores must not drown the list under one row, and zero dependents scores `1`, so a bead that unblocks nothing is not penalised — it is simply not lifted.

## Deadlines

A `--due` date is the one deadline field, and `bd` already stores it. The queue multiplies the total by the factor of the narrowest tier the time left fits inside; those factors are the **shipped default**, and a strategy's optional `## Deadline tiers` section replaces them, so moving a tier is a strategy edit and a `bump`, never a code change. A bead with no due date keeps the factor 1. [DEADLINES.md](DEADLINES.md) carries the shipped table, the row syntax, the `validate` rule, the boundary and the defer rule.

## Themes and the balance

The multiplier that stops one theme taking every row. A bead's **theme** is its root ancestor — follow `parent` until it is absent, so a stage chore belongs to the task at the top, not to its own parent. `served(theme)` counts how many of the newest `window` closes belong to that theme, and the factor is `decay ^ served(theme)`: a theme nothing closed in keeps `×1`, and a theme served twice costs `decay × decay`.

The history is a query, never a stored counter. One `bd list --all` read per scope supplies the closed beads, and nothing is written back: the effect survives a session, a machine and a worktree because the tracker already holds it, and a bead's stored `rice` record never moves. Three filters apply: only `closed` beads with a readable `closed_at` count; beads labelled `stage:*` or `lifecycle:*` are pipeline steps rather than items, so one task's stage chores cannot penalise its theme; and a bead is grouped by its root ancestor, never by its immediate parent.

Both numbers are the strategy's, in an optional `## Theme balance` section: `window` and `decay`, defaulting to `{ window: 5, decay: 0.7 }` when the section is absent. `decay: 1` makes every factor 1, which turns the balance off without deleting the section. The row prints the factor on every row, factor `×1.00` included, and names the theme when it is not the row's own id, so the total can always be checked against the bead's stored score.

## Scopes

A scope is one bd workspace. The queue reads every one and writes to none; the current workspace is the only writable scope, so every other is read-only, and a missing workspace is `unavailable` and skipped. A shared invocation (`--shared`, or `AGENT_CORTEX_QUEUE_SHARED=1`) withholds every personal scope and the daily note, and prints the count. [SCOPES.md](SCOPES.md) carries the list format, the writable rule, the daily note and the boundary.

## The report

One flat list, no sections, ranked first and unscored last:

```
HITL decision queue · 3 ranked, 1 unscored · 3 scopes, 1 unavailable · strategy v2
total = rice × (1 + ln(1 + dependents)) × 1.5 in-progress × deadline tier × theme balance · ties break on rice, then scope, then id · unscored last
excluded: 3 kind:idea beads (--include-ideas ranks them)
today · personal, code — "daily: personal, code — Monday and Tuesday are the personal objectives" (strategy v3, "## Current themes", scope notes)
unavailable: ops (/srv/ops) — workspace does not exist

1  code    bd-7  10.0  rice 4.2 = R4 · I3 · C0.7 · E2  ×2.39 dependents(3)  ×1.0  ×1.00 theme (untouched)
    Ship the queue — unblocks bd-8, bd-9, bd-10
2  notes   bd-2   8.0  rice 4.2 = R4 · I3 · C0.7 · E2  ×1.00 dependents(0)  ×1.0  deadline ×8 OVERDUE by 1d (due 2026-11-14T08:59Z)  ×0.49 theme bd-20 (2 served)
    Decide the API shape — unblocks nothing
-  code    bd-4     —  unscored — no rice metadata (score it with score-bead)
    Decide the rollout — unblocks nothing
```

Every row carries its rank, scope, id, total, the four components the score was computed from, all four multipliers, a deadline clause when the bead has a due date, the theme clause, the title, and one clause naming what the answer unblocks — the scope tag keeps two workspaces that reuse a bead id apart. An unscored row keeps its place at the end of the same list with the reason: no `rice` metadata, no score inside a `rice` record, or scored against an older strategy version (that last one is ranked and marked `scored at strategy v2, current v3`). `--json` prints the same answer with every derived field, including each scope's status and the daily note, for a caller that needs to act on it.

### The list, and one item from it

A session that must decide shows the queue's first ten rows, one line each, with the top row marked as the recommendation: every row carries its scope, its id, its total, the four components with all four multipliers, the due moment where it has one, and what answering it unblocks, so a wrong top pick can be argued with instead of taken. Fewer eligible rows than the count says the list is complete; more states how many were omitted and the command that shows them. `recommend.mjs` also prints one row alone with the strategy line that justifies it, and a stated condition with one next step when it cannot justify a row. It ranks nothing: the total, the components and the multipliers are the row's own. [RECOMMEND.md](RECOMMEND.md) carries the `--top` count, the omission line, the six stated conditions, the `--why` rule, and the routing a row other than the top takes. When that item is done, `boundary.mjs` compares the theme's next item against the queue's top item and prints both scores, and [BOUNDARY.md](BOUNDARY.md) carries the block, the two outcomes and the options.

```bash
node <skill-scripts>/recommend.mjs shortlist                 # the top ten, top row marked
node <skill-scripts>/recommend.mjs recommend --why "<line>"  # the one block to say
```

## Ordering rules

- **Ranked by total, descending.** The total is rounded to one decimal *before* ranking, so the number a reader sees is the number the order was decided by.
- **Ties break on rice, then scope, then id.** `ln` flattens, so different dependent counts can reach the same one-decimal total; a fixed tie-break means two runs over one backlog print byte-identical output. The scope breaks the tie before the id because two workspaces may hold the same bead id.
- **Unscored beads never earn a rank.** They are listed, not placed, and never compared by title or by priority.

## Workflow

1. **Check the strategy is readable.** The queue compares each score's `strategyVersion` against the file to mark stale scores, and reads its deadline tiers and its theme balance. Run `strategy.mjs validate` first. A missing or invalid strategy does not stop the queue — the scores are already on the beads — but the header then reports `strategy unknown`, no staleness, and the shipped deadline and balance defaults.

2. **Run the queue.** This is the hand-run form: no planner, no agent, one command.

```bash
node <skill-scripts>/queue.mjs queue
```

3. **Report it as printed**, then name the top item plainly: id, title, and what answering it unblocks. Do not group by priority, re-sort, or drop the unscored rows — the flat list is the answer.

4. **Score what is unscored, one bead at a time.** Load `score-bead`, judge the four components against the strategy, and record the score. Re-run the queue; the bead takes its place.

```bash
node <skill-scripts>/queue.mjs queue --file <path> --include-ideas
```

| Option | Effect |
|---|---|
| `--scopes <path>` | Scope list. Default `.agent-cortex/scopes.json` from the repository root, then `~/.agent-cortex/scopes.json`, then the current workspace alone. |
| `--shared` | Output that leaves this machine: personal scopes are not read, and the daily note is withheld. |
| `--file <path>` | Strategy file. Default `.agent-cortex/working-docs/strategy.md`, relative to the repository root. |
| `--include-ideas` | Rank `kind:idea` beads too. They are excluded by default — see below. |
| `--cwd <dir>` | Directory the current workspace, its strategy path and `bd` resolve from. |
| `--json` | Print the report as JSON, including each scope's status and the daily note, for a caller that needs to act on it. |

`BD_PATH` pins the `bd` binary. Exit `0` means the queue was built, including a run that ranked nothing or skipped an unavailable scope; exit `1` means an internal failure, and exit `2` a malformed argument or a scope list that cannot be read. The script makes no writes: the tracker calls are `bd list` and `bd dep list`, nothing else, and a read-only scope receives no other call.

## What the queue leaves out

- **Ideas, by default.** `kind:idea` beads are HITL by convention but deliberately unshaped: a RICE score on an idea measures a guess about a guess, and the idea backlog is ranked by `flesh-out-idea` instead. An idea that outranks a ripe decision would send the owner into an interview they did not choose. The count is printed so nothing is dropped silently; `--include-ideas` ranks them when the backlog is what the owner is working.
- **Deferred, closed and blocked beads.** A bead deferred into the future stays out of the queue until that date passes, and the count is printed; the queue never adds a second deferral concept. Finished work waits on nothing. A scored bead an **open** `blocks` dependency points at is withheld from the ranking and counted on the `excluded:` line, with the blocker named in `--json` under `withheld[].blockedBy`, because a row nobody can answer yet must not be the one item a session says out loud; `bd dep list <id> --direction down` is that read, and a closed blocker changes nothing. An ownership edge is not a blocker: an epic that owns a bead does not stop it being answered.

## Red Flags

- Red flag: writing to a scope the list did not mark writable, so personal work lands in a code workspace.
- Red flag: reporting only the scopes that answered, so a missing workspace looks like an empty backlog — or inventing a daily note instead of quoting the strategy line.
- Red flag: scoring a bead inside this skill, so the queue's order rests on an unreviewed number.
- Red flag: ranking an unscored bead by its priority or its title, so the list looks complete and hides the gap.
- Red flag: counting dependency paths instead of distinct beads, so a diamond inflates one row above its real value.
- Red flag: re-sorting or grouping the flat list before reporting it, so the order the owner reads is not the order that was computed.
- Red flag: hardcoding a deadline factor in the script, so the owner cannot tune the rise without a release.
- Red flag: excluding ideas, deferrals or blocked beads without printing how many were excluded and why.

## Verification checklist

- [ ] The report is one flat list: ranked rows first, unscored rows last, no sections.
- [ ] Every row is tagged with its scope, every unavailable scope is named with its reason, and the daily note above the list quotes the strategy line with its version and section.
- [ ] Each row shows the rank, scope, id, total, the four components, all four multipliers, the title and what the answer unblocks.
- [ ] A bead blocking three others ranks above an equal bead blocking none; an in-progress bead ranks above an equal not-started one.
- [ ] A bead due in three days ranks above an otherwise identical bead with no due date; an overdue bead is flagged `OVERDUE` and carries the top tier of the table in force. Every row with a due date shows the due moment and the time left, only a ranked row shows a factor, and a changed tier moves the rank with no code change.
- [ ] With no scores, the header says nothing can be ranked and every candidate is listed unscored with a reason.
- [ ] Two identical runs printed byte-identical output, and the excluded idea, deferred and blocked counts were reported, or the header said there were none.
- [ ] A session that had to decide showed the marked top row among ten one-line rows, each carrying its components, its unblocks, its scope and its due date, and stated what it omitted (or that the list was complete) — or said one stated condition with its next step.

## See Also

- [SCOPES.md](SCOPES.md) — the scope list: its file, its default, the writable rule and the privacy boundary.
- [score-bead](../score-bead/SKILL.md) — owns the `rice` record this queue reads, and the band proposal.
- [strategise](../strategise/SKILL.md) — owns the strategy file and its version.
- [bd-tool](../../productivity/bd-tool/SKILL.md) — the tracker commands, and where operational state lives.
- [hitl-collab](../hitl-collab/SKILL.md) — the handoff document for a decision that needs more than an answer.
