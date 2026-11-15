# One recommendation

The queue is a list; a session that has to decide says one item and stops. `recommend.mjs` prints
that one row — the same total, components and multipliers the queue computed, plus the line of the
strategy that justifies it — and states a condition instead of choosing whenever it cannot justify
a row.

Every run ends in one of five answers: the block, or one of the four conditions that replace it.

It ranks nothing. The bead is `rows[0]` of the queue, or the bead the human named, and every number
on the block is the row's own.

## The three commands

```bash
node <skill-scripts>/../../strategise/scripts/strategy.mjs validate    # prints the rubric
node <skill-scripts>/recommend.mjs recommend --json     # the top row, structured
node <skill-scripts>/recommend.mjs recommend --why "<one line of the rubric>"
```

`validate` first, because the printed rubric is the only text a justification may be quoted from.
`--json` second, to read the row's id and totals. `--why` last, once the line that justifies that
bead has been chosen from the rubric.

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

| Option | Effect |
|---|---|
| `--why "<line>"` | The strategy line that justifies the choice; required before a block is printed |
| `--bead <id>` | Recommend the bead the human named, noting the queue's own top choice |
| `--file <path>` | Strategy file (default `.agent-cortex/working-docs/strategy.md`, relative to the repository root) |
| `--include-ideas` | Rank `kind:idea` beads too, as the queue does |
| `--cwd <dir>` | Directory the strategy path and `bd` resolve from |
| `--json` | Print the answer as JSON, including the state name |

Exit `1` means a `bd` call failed, and exit `2` means a malformed call — an unknown option, or a
`--why` the strategy does not contain. `BD_PATH` pins the `bd` binary. The script makes no writes:
the tracker calls are `bd list` and `bd dep list`, nothing else.
