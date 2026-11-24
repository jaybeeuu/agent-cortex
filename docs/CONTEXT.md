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
established but not its raw turns. Chosen by the decision. See flush, rewind, decision.

# flush

Drop the window and start fresh, keeping nothing but what the tracker already holds. The window
transition of a **switch**, because a summary of a theme you have just left is the noise the flush
exists to remove. Chosen by the decision.

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

The four steps are one movement, not a menu: an interrupt is opened by its checkpoint and closed by
its rewind. An interrupt that has not rewound has not finished, so the rewind is not chosen — it is
owed. See rewind, decision, boundary.

# rewind

Drop every turn after a checkpoint, keeping everything before it. The **completion of an interrupt**:
once the interrupt's work is recorded, this is the only way back, so it is not one of the transitions
a decision chooses between.

It differs from the other two in kind. A compact and a flush move the window forward, chosen by a
boundary decision; a rewind makes the window match the moment the interrupt interrupted. It is also
the only one that restores a known state rather than summarising it or discarding it. See interrupt,
compact, flush.

# capability

A tool or a command that a harness exposes, named once and resolved per harness. An author writes
`{{CAPABILITY:name}}`, and each harness's row supplies its own name for that capability.

The kind belongs to the harness row, never to the canonical name, because the same capability can be
one on each side: `interrupt_rewind` is a tool on pi and a command on claude. A capability is
therefore authored vocabulary, not a runtime handle — a row with no counterpart for a harness is
`null`, and that harness simply has no name for it. See tool, command.

# tool

A capability the harness offers to the model. It is the only kind a tool list may contain.

A harness row says `{ "name": …, "type": "tool" }`, and an agent's tool set is written in
capabilities, so the rendered list keeps the tool rows and drops the command rows and the rows that
harness has no counterpart for. See capability, command, tool set.

# command

A capability the user or the agent invokes directly: a slash command, or an extension's own command.
It renders into prose and never into a tool list.

Listing one is an authoring error rather than something to correct silently, because a list that
drops it without a word is a list nobody notices is wrong. See capability, tool.

# tool set

The capabilities one agent may use, authored once for that agent and rendered into every harness.

The set is not harness metadata: it is what the agent can do, and it is what the harness enforces. A
set authored twice — once per harness — drifts, and the drift is silent, so it is authored once and
checked against the text that names the tools. See capability, tool.
