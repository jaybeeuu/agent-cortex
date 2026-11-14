---
"@jaybeeuu/agent-cortex": minor
---

Add the `post-merge-watch` pi extension: poll the post-merge check and wake an idle session with
the verdict.

`pi --post-merge-watch <bead>` polls
`skills/workflow/ralph/scripts/post-merge-check.mjs` every 15 s (up to 40 checks) and, when the
script reports a verdict, sends one message with
`pi.sendMessage(..., { deliverAs: "followUp", triggerTurn: true })`, so a session that is idle
starts a turn with the result. The message names the bead, the verdict, the exit code, the reason,
the run URL, the project, and the number of checks; the same fields ride along as message
`details`.

The extension owns no verdict logic: the check's exit code is the verdict (`0` passed, `1` failed,
anything else inconclusive, including a timeout kill), and the run URL is forwarded from the
script's JSON report. It makes no model call, imports pi as types only, registers its CLI flag in
the extension factory, and spawns no process or writes no state when the flag is absent. Each
invocation passes `--wait 0`, so the poll interval and the bound live in the extension and a
stopped watch never blocks on a child process.

State lives under `~/.pi/agent-cortex/post-merge-watch/`, one file per project path and bead (the
name carries a digest of both, so two projects watching one bead never collide), and is removed
when the watch settles or the session shuts down. The pending timer is unref'd and cancelled on
shutdown, so an abandoned watch leaves no orphan timer and no state file. The default check script
is resolved relative to the extension file, so the staged pi package (`extensions/` beside
`skills/`) needs no hardcoded absolute path; `AGENT_CORTEX_POST_MERGE_CHECK` overrides it. PI only:
Claude Code uses its own watch tools.
