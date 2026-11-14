---
"@jaybeeuu/agent-cortex": minor
---

Add the `interrupt-bookmark` extension: two tools around pi's own tree navigation, so an interruption
stops dragging its turns into the context the original task then has to carry. `interrupt_checkpoint`
returns the current leaf id as a resume point. `interrupt_resume { checkpointId, summary }` rewinds
there, keeps the abandoned branch under a branch summary labelled `interrupt`, and reports the summary
entry. The summary comes from pi's own navigation summariser — the extension makes no model call and
deletes nothing. Navigation is command-only in pi (`waitForIdle()` and `navigateTree()` live on
`ExtensionCommandContext`; a tool call is always inside a streaming turn), so the resume tool
validates the request, ends the turn, and an `agent_settled` handler dispatches the command that
rewinds — the pattern pi documents for a tool that must reach a command-only API. An unknown
checkpoint id fails naming the id and writes nothing; navigation is retried exactly once after a
fresh wait for idle, and a second failure reports the reason and leaves the conversation unchanged.
`token-map.json` gains the `interrupt_rewind` row — `interrupt_resume` on pi, Claude Code's `/rewind`
command on claude — with a note recording why the two values differ in kind and why the checkpoint
half is never tokenised.
