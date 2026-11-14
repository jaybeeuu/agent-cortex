# Post-Merge Watch Extension

Wakes an idle PI session with the verdict of a post-merge CI run.

A human merges the feature PR, and the CI run for the merge commit decides what
happens next: nothing, a fix, or a revert. That merge lands outside the session,
so nothing tells the agent when the run concludes. This extension polls the
deterministic post-merge check and delivers the verdict as a follow-up message,
which starts a turn in an idle session.

## Usage

```bash
pi --post-merge-watch <bead>
```

| Input | Meaning |
| --- | --- |
| `--post-merge-watch <bead>` | Watch the post-merge check for this bead and wake the session with the verdict |
| `AGENT_CORTEX_POST_MERGE_CHECK` | Path of the check script, when the shipped one is not the one to run |

The flag is registered at load time, so it is accepted on the command line. A
session without the flag starts no watch, spawns no process, and writes no state.

The default script is `skills/workflow/ralph/scripts/post-merge-check.mjs`,
resolved relative to this extension's own file. In a staged install
(`extensions/` beside `skills/`) and in a checkout of this repository the same
relative path resolves, so no absolute path is baked in.

## What it does

1. At session start, with the flag set, it records the watch and runs the check.
2. It runs the check every 15 seconds, up to 40 times (about 10 minutes).
3. When the check exits `0` (passed) or `1` (failed), or the attempt cap is
   reached, it sends one message and stops watching.

Each invocation passes `--wait 0`, so the script reports once instead of waiting
inside itself: the poll interval and the bound belong to this extension, and a
stopped watch never blocks on a running child process.

The wake uses the confirmed PI signature
`pi.sendMessage(message, { deliverAs: "followUp", triggerTurn: true })`: an idle
session starts a turn from it, and a session in the middle of a turn reads it
after that turn instead of being interrupted.

The message names the bead, the verdict, the exit code, the reason, the run URL,
the project, and the number of checks made. It carries the same fields as message
`details`, so a renderer can read them without parsing the text.

## What it never does

- **No verdict logic.** The check's exit code is the verdict: `0` passed, `1`
  failed, every other code (including a timeout kill) inconclusive. The run URL
  and the reason are read from the script's JSON report and forwarded verbatim.
  The extension never decides whether a run passed and never re-runs a workflow.
- **No model call.** No prompt, no summarisation, no title generation. One turn
  happens only because the delivered message starts one.
- **No `@earendil-works/*` value import.** Types only, so the staged install
  loads with pi absent from the extension's own `node_modules`
  (`test/pi-extensions-load.test.mjs` proves this).
- **No second watch for the same bead.** A session reload re-fires
  `session_start`; the extension starts one watch per bead.

## State

| Item | Value |
| --- | --- |
| Directory | `~/.pi/agent-cortex/post-merge-watch/` |
| File name | `<project dir name>-<bead>-<digest of full project path and bead>.json` |
| Written | At watch start, then after each poll |
| Removed | When the watch settles, when the session shuts down, and again if a write was still in flight |

The digest covers the whole project path, so two checkouts whose directory names
match — or two projects watching the same bead — never share a file. A watch that
is still polling is the only thing the directory should hold.

The write and the removal can race: a stop removes the file, and a write that is
still in flight then recreates it. The write therefore re-checks whether the
watch stopped once it completes, and removes the file again, so a stop cannot
leave a state file behind. One narrow case survives: a write that **fails** while
a stop is in progress returns before that re-check, so it can leave a partial
file. No code reads the directory, so a partial file is cosmetic; do not read it
as a live watch.

The in-flight record is diagnostic: it names the bead, the project, the script,
the pid, the attempt count, and the last exit code and reason. Nothing reads it
back, so a watch never resumes from it; a new session with the same flag starts a
new watch.

## Bounds and shutdown

| Bound | Value |
| --- | --- |
| Poll interval | 15 s |
| Checks | 40 |
| One check invocation | 120 s, then pi kills it |

The pending timer is unref'd, so a watch never holds the host process open. On
`session_shutdown` the timer is cancelled, a check already in flight is ignored,
and the state file is removed: an abandoned watch wakes nobody and leaves nothing
behind.

## What has been proven

The wake path has been run once end to end against a stub check script: the RPC
wake itself was reproduced (`agent_settled` → `agent_start`, the custom message
arriving with no client prompt), and a real model turn ran on it. That run did not
read a real CI run, because the shipped `post-merge-check.mjs` was replaced by a
stub: the poll-and-wake path is proven, and the check's own judgement is covered
by `test/post-merge-check.test.mjs`, not by any test here. Treat the pair as one
path only after a watch has read a genuine merge-commit run.

## Claude Code parity

PI-only. Claude Code has its own watch tools, which the Claude side uses instead of
an extension.

## Development

```bash
pnpm test        # the poll lifecycle, the wake payload, the state file, the wiring
pnpm typecheck   # tsc --noEmit
```

`watch.test.ts` drives the whole lifecycle with a scheduler it steps by hand and a
check runner that returns scripted exit codes, so no test sleeps or waits on a
timer. `index.test.ts` drives the extension through a partial `ExtensionAPI`
double; the complete-literal guard that fails `tsc` when pi's interface grows is
`extensions/agent-modes/index.test.ts`.

To watch the poll end to end against a script that is not the shipped one, point
`AGENT_CORTEX_POST_MERGE_CHECK` at any executable that follows the check's
contract: JSON on stdout and exit `0`/`1`/`2`.
