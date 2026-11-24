# Session Transition Extension

Gives an agent the two window transitions a boundary decision chooses: a **stay** compacts the
window, a **switch** flushes it.

A boundary hands the session one of two outcomes. A stay keeps working the same theme, so the next
item needs what the last one established — but not its raw turns. A switch leaves the theme, so a
summary of it is the noise the flush exists to remove. Neither transition could be asked for
deliberately, so this extension adds a tool for each.

## Usage

| Tool | Description |
| --- | --- |
| `request_compact` | Arms a compaction: summarise the window, keep the recent tail |
| `request_flush` | Arms a flush: drop the window, carry nothing across |

Both take `{ reason }` — one line saying what the item established, or why the theme is changing —
and both end the turn. The transition runs once the session is idle, and the tool result confirms
what was armed.

The extension also registers the `session-flush` command, which is what performs a flush. The model
does not call it and neither should you need to: an armed flush dispatches it.

## Why each request is armed, not performed

Neither transition may run while the turn that asked for it is still going. A tool call runs inside
a turn, and a session replacement tears down the very turn it would be called from, so a tool cannot
do either job. Each tool records the request, returns a confirmation, and ends the turn with
`terminate: true`; an `agent_settled` handler acts on it. `agent_settled` is the final-idle signal —
`agent_end` fires again when more work starts, so it is not one.

## Why the flush dispatches a command

The two transitions reach pi through different contexts:

| Transition | Member | Declared on |
| --- | --- | --- |
| Compaction | `ctx.compact()` | `ExtensionContext` — every handler and tool |
| Flush | `ctx.newSession()` | `ExtensionCommandContext` — command handlers only |

So the settle handler calls `compact()` directly and cannot reach `newSession()` at all. It
dispatches `/session-flush` through `pi.sendUserMessage(..., { expandPromptTemplates: true })`
instead, which runs the command rather than prompting the model. Both are the patterns pi documents
for a tool that must reach a turn-scoped or command-only API (`docs/extensions.md`, "ctx.reload()"),
and `interrupt-bookmark` in this package uses the same dispatch for its rewind.

## Single-use, and carrying nothing

The armed request is one in-memory slot. Taking it empties the slot before anything is acted on, so:

| Case | Behaviour |
| --- | --- |
| No transition armed | A settle acts on nothing |
| One arming, two settles | The first acts, the second finds the slot empty |
| Armed twice before a settle | The newest arming is the one acted on, once |
| Second tool call after an action | Arms again, and the next settle acts |
| Blank reason | Refused before anything is armed, naming what the reason is for |

Nothing is written to disk. The flush replaces the session with `newSession({ parentSession })`,
which records the old session's file as lineage in the new header and nothing else: no `setup`, no
`withSession`, no summary, no theme id. The replacement session's own start re-establishes its
rubric and its queue, and the tracker restores any theme on demand, so a handoff would only carry
what the flush exists to remove.

## Failure modes

| Case | Behaviour |
| --- | --- |
| Compaction refused by the provider | Reported as an error; the window is unchanged and the session continues in it |
| Flush cancelled by pi or an extension | Reported as a warning; the window is unchanged |
| `session-flush` run with nothing pending | Warns and replaces nothing |
