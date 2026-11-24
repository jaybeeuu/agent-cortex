# theme

The current epic and its children: the one body of work a guppi session is on. "A theme is one epic
and its children, and the tracker holds everything needed to continue it." A session works one
theme. See boundary, item.

# item

The smallest unit of human work guppi completes: a decision recorded, a plan created, a handoff sent,
a review given. Items belong to a theme. See boundary.

# boundary

The completion of one item. The moment guppi re-ranks: it runs `boundary` in `hitl-queue`, says the
block, and asks for one of three outcomes — stay, switch or move — which `--decide` writes to the
theme bead's trail.

A completed task is one kind of item, so every completed task is a boundary. The reverse does not
hold: recording a decision is a boundary at which no task has completed. See item, theme, task.

# task

Not a defined unit. Shipped text uses "task" loosely for the thing the human brought to the session —
"guppi is resident and works one task at a time" — so a phrase such as "when a task completes" names
no moment the domain can locate. The defined units are item and theme; a phrase that means a moment
should name one of those, or a boundary. See item, theme, boundary.

# clear

Any reset that drops the window — `/clear` and anything that replaces it. Rules are written against
a clear, never against one command name, so they survive the mechanism changing. A clear drops the
window; it does not reseed it. See flush.

# flush

Write the outcome to the tracker, then drop the window, keeping the bead ID. A flush is the act; a
clear is the mechanism it uses.

A flush happens at a boundary whose decision leaves the theme — a switch or a move — and never at a
stay. A stay keeps the window, because the next item on the theme needs what the last one
established; the trail and the memory are still written. See boundary, decision, clear.

# decision

The answer guppi records at a boundary, one of stay, switch or move, passed to `boundary` as
`--decide` and written to the theme bead's trail with a timestamp. A decision that leaves the theme
is what triggers a flush. See boundary, flush.

