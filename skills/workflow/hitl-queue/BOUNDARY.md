# The boundary re-rank

A session that answers one item at a time drifts: the next item is whichever one was nearest, not
whichever one matters most. This file defines the unit a session works in, and the one comparison
it makes when that unit finishes.

## The unit of work

| Term | Meaning |
|---|---|
| **Theme** | The current epic. One theme at a time, and its children are the items it needs. |
| **Item** | One thing the theme needs from a human: a decision answered, a plan shaped, a handoff written, a review given. |
| **Boundary** | The completion of one item. The point where the session stops and checks whether the theme is still the right place to be. |

The theme and its trail are the session's memory, not the window: a clear drops the window, and
`bd show <epic-id>` still holds what was decided and why. [RECOMMEND.md](RECOMMEND.md) carries the
one-item session start; this file carries what happens after that item is done.

## The decision at every boundary

One trade-off, two outcomes, and no third:

| Outcome | When it is right | Read from the scores? |
|---|---|---|
| `stay` | Continue in the theme. The theme's next item still leads the queue. | Yes |
| `switch` | Leave the theme, because higher-priority work waits elsewhere. | Yes |

Both are read from the two totals, so the boundary records one of these two and nothing else. A
leave that is not about priority — stepping out for one item and coming back — is an
**interrupt**, not an outcome: the guppi agent's `## Interrupts` section owns that route, with the
checkpoint, the record, the rewind and the resume it needs.

## The block

```text
Boundary · theme tst-t · strategy v2
recommendation: switch — the queue's top item scores 8.0 against the theme's next 4.2, so higher-priority work waits elsewhere
theme next  tst-a · total 4.2 · Decide the theme question
queue top   tst-b · total 8.0 · Decide the outside question
next: stay or switch is the human's call — nothing is recorded until they answer
```

**Both scores are always printed**, and the reason names both. That is the whole rule: an agent
that leaves a theme without showing what it left for has asserted a priority it never displayed.
A switch with no comparison on screen is a defect, not a summary.

The recommendation is derived from the two stored totals and nothing else. The totals, the
components and both multipliers are the queue's; this comparison computes no score, so the number
a reader checks is the number the queue ranked by. [SKILL.md](SKILL.md) owns that arithmetic.

## The record

```bash
node <skill-scripts>/boundary.mjs boundary --theme <epic-id>
node <skill-scripts>/boundary.mjs boundary --theme <epic-id> --decide switch
node <skill-scripts>/boundary.mjs boundary --theme <epic-id> --decide stay --reason "<what the decision buys>"
```

A run with no `--decide` prints the comparison and writes nothing. A run that names a decision
writes one trail entry with `bd note` on the **theme bead** — the epic that owns the items — and
prints it back:

```text
trail: tst-t · [2026-11-15T09:30:00.000Z] boundary: switch · theme next tst-a total 4.2 vs queue top tst-b total 8.0 · reason: the queue's top item scores 8.0 against the theme's next 4.2, so higher-priority work waits elsewhere
```

Three parts, and all three are required: the **timestamp**, **both scores**, and the **reason**.
A later session reads `bd show tst-t` and sees why the theme was kept or left, without reading a
transcript. An entry with a reason but no numbers cannot be checked, and an entry with numbers but
no reason says nothing about intent.

## Recommends, never switches

- **The human decides.** `--decide` is the recording step, and it is passed after an answer, never
  instead of asking for one. Nothing switches on its own.
- **A decision against the recommendation needs `--reason`.** A `switch` that the scores do not
  point to needs one, and so does a `stay` that skips higher-scoring work elsewhere. The refusal
  is the point: an unexplained override is the case the trail exists to catch.
- **The boundary changes what to do next, never what outranks what.** The order is the queue's and
  the rubric is the strategy's. A wish for a different order is a `strategise` change, not a
  boundary decision.

## Which item is compared

`--theme <epic-id>` names the theme. The theme's next item is the **highest-ranked item under that
theme** in the queue, so the comparison cannot be steered by naming a weak one. `--next <id>` names
another item when the session knows better, and the queue's top item is rank 1 either way.

## The states that are stated instead of guessed

| First line | What it means | The step it offers |
|---|---|---|
| `No boundary · the queue is empty` | No open `execution:hitl` bead exists | File the theme's next item, or lift a deferral |
| `No boundary · theme <id> has no ranked item` | Nothing scored sits under that theme | Name the item with `--next`, or score it with `score-bead` |
| `No boundary · <id> is not in the queue` | The named item is not an open scored `execution:hitl` bead | Name one from the queue, or score that bead |

None of them guesses an item and none is a failure of the run: exit `0` means an answer was
printed, whichever answer it was.

| Option | Effect |
|---|---|
| `--theme <epic-id>` | The theme; required, because a boundary belongs to one |
| `--next <id>` | The theme's next item, when the session names it instead |
| `--decide <outcome>` | `stay` or `switch` — record the human's decision |
| `--reason "<text>"` | Why that decision; required when it contradicts the recommendation |
| `--file <path>` | Strategy file (default `.agent-cortex/working-docs/strategy.md`, relative to the repository root) |
| `--include-ideas` | Rank `kind:idea` beads too, as the queue does |
| `--cwd <dir>` | Directory the strategy path and `bd` resolve from |
| `--json` | Print the answer as JSON, including the decision and the trail entry |

Exit `1` means a `bd` call failed and exit `2` means a malformed call — a missing `--theme`, an
outcome outside the two, or a decision against the scores with no reason. `BD_PATH` pins the `bd`
binary.

## Red Flags

- Red flag: leaving a theme without the two scores on screen, so the reader has to trust the agent.
- Red flag: recording a decision with no reason, or a reason with no numbers in the trail entry.
- Red flag: switching because the agent judged the priority itself, instead of reading the queue.
- Red flag: recomputing a total here, so the comparison and the queue can disagree.
- Red flag: recording a decision the human has not given, so the session switches on its own.
- Red flag: writing the trail entry to another scope, so a theme's history lands somewhere its
  owner will not read.
