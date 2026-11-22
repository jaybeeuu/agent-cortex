# One recommendation, and the list it came from

The queue is a list; a session that has to decide says one item and stops. `recommend.mjs` prints
that one row — the same total, components and multipliers the queue computed, plus the line of the
strategy that justifies it — and states a condition instead of choosing whenever it cannot justify
a row.

It also prints the **top ten**, because one row on its own cannot be argued with: a wrong top pick
reads exactly like a right one when the runner-up is hidden. The two commands share every number.

Every run ends in one of seven answers: the list with its top row marked, the block, or one of the
six conditions that replace them.

It ranks nothing. The bead is `rows[0]` of the queue, or the bead the human named, and every number
on the block is the row's own. A row the queue withheld — a scored bead an open `blocks` dependency
points at — is never named, because a gate nobody can close yet is not an answer anyone can give.

## The four commands

```bash
node <skill-scripts>/../../strategise/scripts/strategy.mjs validate    # prints the rubric
node <skill-scripts>/recommend.mjs shortlist            # the top ten, marked
node <skill-scripts>/recommend.mjs recommend --json     # the top row, structured
node <skill-scripts>/recommend.mjs recommend --why "<one line of the rubric>"
```

`validate` first, because the printed rubric is the only text a justification may be quoted from.
`shortlist` for a session that has to decide and be argued with. `--json` second, to read the row's
id and totals. `--why` last, once the line that justifies that bead has been chosen from the rubric.

## The quote rule

`--why` names a line, or part of one, from the strategy file. The script finds that line in the
file, prints it verbatim with the section it sits under, and refuses the run (exit `2`) when no line
contains it. Guidance comments in the file are not quotable: they are instructions for whoever
writes the rubric, not the owner's own words.

```text
why: "shorter review turnaround for human-gated work." · Current themes
```

A quote the file does not hold is a refused run rather than a weaker reason, so an invented
justification cannot reach the human.

## The list, and the marker on its top row

The first ten rows of the queue, one line each, with the top row marked as the recommendation:

```text
HITL shortlist · 10 of 14 eligible · 12 ranked, 2 unscored · strategy v2
excluded: 1 kind:idea bead (--include-ideas ranks them)
why: "shorter review turnaround for human-gated work." · Current themes

 1  code  tst-b   27.9  Ship the decision queue  ·  rice 11.0 = R4 · I3 · C0.7 · E2  ×1.69 dependents(1)  ×1.0  deadline ×1.5 in 2d 23h (due 2026-11-24T15:46Z)  ·  unblocks tst-w  ·  ← recommendation
 2  code  tst-a   20.3  Decide the API shape  ·  rice 12.0 = R4 · I3 · C0.7 · E2  ×1.69 dependents(1)  ×1.0  ·  unblocks tst-w
 3  code  tst-c   10.0  Report the queue  ·  rice 10.0 = R4 · I3 · C0.7 · E2  ×1.00 dependents(0)  ×1.0  ·  unblocks nothing

11 omitted, see them with node <skill-scripts>/queue.mjs queue
a row other than the top is a priority challenge — run strategise, never a reorder
```

One line, one bead: rank, scope, id, total, title, the four components with both multipliers, the
due moment where the bead has one, and what answering it unblocks. The rows, their order and every
number are the queue's own — nothing is re-sorted and nothing is recomputed — so the order is the
answer and the columns are the evidence for it.

**The count is `--top`, and its default is 10.** Fewer eligible rows than the count says `the list
is complete`; more states how many were omitted and the command that shows them, so no row leaves
the list without a trace. A row the queue withheld is counted on the `excluded:` line and never
listed.

**A row other than the top is a priority challenge, never a selection.** Saying "row four" is a
claim about the rubric that produced the order, so it takes the strategy-review path — the sequence
and the refusals in [CHALLENGE.md](../strategise/CHALLENGE.md) — and the list is not touched on the
spot: the rubric moves first, or the order stands and the answer says so.

## The block

```text
Recommendation · tst-a · total 10.0 · strategy v2
Ship the decision queue
rice 4.2 = R4 · I3 · C0.7 · E2  ×2.39 dependents(3)  ×1.0
unblocks tst-c, tst-d, tst-e
why: "shorter review turnaround for human-gated work." · Current themes
```

Five lines: the bead and its total, its title, the four components with the unblocking multiplier
and the work-in-progress multiplier, the beads the answer releases, and the strategy line. One
recommendation, never the list the row came from.

## When the human names a bead

`--bead <id>` recommends the bead the human named instead of the top row. The block is the same,
and one line is added when the queue put a different bead first:

```text
queue top: tst-a · total 10.0 · Ship the decision queue
```

That line is the whole of the disagreement. The human's choice stands, and a wish to see it first
is a strategy change through `strategise`, never a silent override.

## The stated conditions

Each one leads with `No recommendation`, names the condition, and offers the one step that clears
it. None of them guesses a bead, and none of them is a failure of the run: exit `0` means an answer
was printed, whichever answer it was.

| First line | What it means | The step it offers |
|---|---|---|
| `No recommendation · no usable strategy` | The file is absent, or `validate` rejected it; every defect is listed | Write or fix it with `strategise` |
| `No recommendation · nothing is scored` | The queue holds beads, and not one carries a `rice` record | Score one bead with `score-bead` |
| `No recommendation · the queue is empty` | No open `execution:hitl` bead exists; the excluded idea and deferred counts are printed | File the decision as an `execution:hitl` bead, or lift a deferral |
| `No recommendation · <id> is not in the queue` | The bead the human named is not an open `execution:hitl` bead | Check it with `bd show`, then name one from the queue |
| `No recommendation · nothing is answerable yet` | Every scored bead is held by an open bead; the withheld rows and their blockers are printed | Close what blocks one of them, then re-run |
| `No recommendation · <id> is held by an open bead` | The bead the human named leads the queue's withheld rows | Close the blocker the line names, then re-run |

| Option | Effect |
|---|---|
| `--why "<line>"` | The strategy line that justifies the choice; required before a block is printed |
| `--top <n>` | How many rows a shortlist shows; default `10` |
| `--bead <id>` | Recommend the bead the human named, noting the queue's own top choice |
| `--file <path>` | Strategy file (default `.agent-cortex/working-docs/strategy.md`, relative to the repository root) |
| `--include-ideas` | Rank `kind:idea` beads too, as the queue does |
| `--cwd <dir>` | Directory the strategy path and `bd` resolve from |
| `--json` | Print the answer as JSON, including the state name |

Exit `1` means a `bd` call failed, and exit `2` means a malformed call — an unknown option, or a
`--why` the strategy does not contain. `BD_PATH` pins the `bd` binary. The script makes no writes:
the tracker calls are `bd list` and `bd dep list`, nothing else.
