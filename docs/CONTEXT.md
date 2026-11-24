# theme

The current epic and its children: the one body of work a guppi session is on. "A theme is one epic
and its children, and the tracker holds everything needed to continue it." A session works one
theme. See boundary, item.

# item

The smallest unit of human work guppi completes: a decision recorded, a plan created, a handoff sent,
a review given. Items belong to a theme. See boundary.

# boundary

The completion of one item. The moment guppi re-ranks: it runs `boundary` in `hitl-queue`, says the
block, and asks for one of two outcomes — stay or switch — which `--decide` writes to the theme
bead's trail.

A completed task is one kind of item, so every completed task is a boundary. The reverse does not
hold: recording a decision is a boundary at which no task has completed. See item, theme, task.

# decision

The answer guppi records at a boundary, one of **stay** or **switch**, passed to `boundary` as
`--decide` and written to the theme bead's trail with a timestamp.

A decision is about the next theme, not the next item. A stay continues in the theme and may take
any of its items, so skipping a higher-scoring bead elsewhere is ordinary and carries a reason
rather than a separate name. A switch leaves the theme for wherever the queue points. See boundary,
compact, flush, interrupt.

# compact

Summarise the window and carry on: the older turns become a summary and the recent tail is kept.
The window transition of a **stay**, because the next item on the theme needs what the last one
established but not its raw turns.

Compact is one of three window transitions. It keeps a summary; a flush drops the window entirely; a
rewind discards everything after a checkpoint. See flush, rewind, decision.

# flush

Drop the window and start fresh, keeping nothing but what the tracker already holds. The window
transition of a **switch**, because a summary of a theme you have just left is the noise the flush
exists to remove.

A flush does not carry a handoff: the next session's own `## Session start` re-establishes the
rubric and the queue, and `Recover a theme from the tracker` restores any theme on demand. See
compact, rewind, clear.

# clear

The mechanism a flush uses on a harness that offers only a session reset — `/clear` and anything
that replaces it. Rules name the transition, never the command, so they survive the mechanism
changing. See flush.

# interrupt

Work that arrives mid-item and forces its way in: a note from a meeting, PR feedback to pass on, a
Slack todo. Met in four steps — checkpoint at the last clean boundary, record it as the bead its
content implies, rewind to the checkpoint, then resume with one sentence naming the task and the
record.

An interrupt is distinguished from a decision by where it ends: a decision ends a theme, an interrupt
ends nothing and returns you to the item you were on. See rewind, decision, boundary.

# rewind

Drop every turn after a checkpoint, keeping everything before it. The window transition an interrupt
uses, and the only one that restores a known state rather than summarising it or discarding the
window. See interrupt, compact, flush.
