# Idle Watch Extension

Nudges an idle PI session when the work it is watching changes.

A session works only when something prompts it. While it runs, its workers can
stall or vanish, and work that becomes ready sits there until a human speaks.
This extension supplies the missing clock: a tool the caller starts when its
session starts and leaves running until the session closes. The tool starts a
cadence and **returns at once**, so the calling turn ends and the session stays
interactive. Each tick runs one configured check, digests its JSON, and sends one
message carrying only what changed.

The extension owns the cadence, the digest and the nudge. The check owns the
subject: what to poll, and what its result means. This extension has no bead
vocabulary, runs no tracker query, and never decides that an id is ready, blocked
or worth acting on. It only tells its reader that the set of ids changed, and
that reader runs the check again to learn what the change is.

## Usage

| Input | Meaning |
| --- | --- |
| `idle_watch` | Start the watch: arm the cadence and end the turn |
| `idle_watch` with `command` | Poll this check script instead of the configured one |
| `idle_watch` with `action: "status"` | Report the watch without polling; sends nothing |
| `idle_watch` with `action: "stop"` | End the cadence; sends nothing |
| `AGENT_CORTEX_IDLE_WATCH_CHECK` | The check script, when the caller passes no `command` |

The tool is registered at load time, so it is available in every session that
loads this package. Nothing starts on its own: a session that never calls the
tool spawns no process, starts no timer, and sends no message. A caller that
starts it once and reads its status on each wake, arming it again when the status
says it stopped, keeps one cadence for the whole session.

### Where the check comes from

The check is the caller's script, never this extension's. The value resolves in
this order:

1. the `command` argument of the call;
2. `AGENT_CORTEX_IDLE_WATCH_CHECK` from the environment.

A relative path resolves against **the package this extension was installed
into** — not against the caller's directory — so a staged install
(`extensions/` beside `skills/`) finds a package script by the same relative path
this checkout does. The extension bakes in no absolute path. An absolute value is
taken as given, which is how a test or a user points at a script outside the
package. With neither source set, the tool refuses to start and names both.

## What one tick does

1. Runs the check as a child process, with the session's own executor, in the
   project directory, under a 60 s timeout. The executor runs it with the
   session's node binary, so the check is a Node script, not an arbitrary shell
   command line.
2. Reads the run as a digest: every non-empty string `id` the JSON mentions,
   tagged with the property that carried it — `ready:agnt-ctx-1`,
   `stalled:agnt-ctx-9` — sorted, so a reordering is not a change.
3. Compares that digest with the previous tick's.

| Tick outcome | Message |
| --- | --- |
| First tick after arming | The baseline, never a difference report: one message naming every id found, or silence when it names none |
| Digest changed | One message naming the ids that arrived and the ids that left |
| Digest unchanged | None |
| No digest: exit code ≠ 0, timeout, empty or unparseable output | None |
| The check could not be spawned at all | None, and one warning in the UI |

The tag is what makes a move a change: an id that leaves `ready` and appears
under `stalled` is reported as removed and added, so a bead that goes quiet
reaches the session as a change rather than as silence.

The nudge carries the change and nothing else. The full result stays with the
check: the message tells its reader to run the check for the rest, so a queue of
forty beads costs one line per change instead of forty lines per tick.

A tick that fails does not end the watch, and it does not clear the previous
digest. A later good tick is therefore compared with the last good one, so a
tracker that recovers does not report its whole queue as an arrival.

## Scope

| Bound | Value |
| --- | --- |
| Poll interval | 15 s |
| Backoff | Doubles per quiet tick, capped at 120 s, reset by a change |
| Duration | The session. No tick count and no deadline stops it |
| One check invocation | 60 s, then pi kills it and the tick counts as failed |
| Retry after a failed tick | The next interval. A failure never ends the watch |

**The session is the only bound.** There is no tick budget to spend and no
timeout to reach, because the work this watch exists for can become ready at any
point in a long session. A watch left alone backs off to the 120 s cap and keeps
looking: an idle hour costs about 30 silent checks and wakes nobody. The watch
ends when the caller stops it (a session closing, or a caller that no longer
needs it), and never on its own.

**A stopped watch is repaired by arming it again.** `status` reports
`watching: false`, and the caller's rule is to arm it when it is not watching.
Arming is cheap and idempotent in shape: it cancels any previous timer first, so
one arming leaves exactly one cadence and a re-armed watch never delivers a
change twice.

**Arming drops the previous digest.** The first tick after a start is a
**baseline**, not a change report: it records what the check reports now, and it
sends nothing when the result names no ids. An empty queue therefore wakes
nobody, and the first id to arrive after that is the change. A caller that arms
the watch after doing work is told what is there now, not what changed since a
watch it has already finished with. A start also replaces a running watch rather
than adding a second one.

The pending timer is unref'd, so a watch never holds the host process open. On
`session_shutdown` the cadence is stopped and its timer cancelled: an abandoned
watch wakes nobody.

## The status report

`status` sends nothing and runs no check. It reports:

| Field | Meaning |
| --- | --- |
| watching | Whether the cadence is running |
| last check | ISO time of the last tick, or none yet |
| checks run | Ticks so far |
| nudges sent | Messages this watch has produced |

A stopped watch keeps these numbers, so a watch that never fired is a
measurement rather than an absence. `watching: false` is the one field a caller
acts on: it means the clock is gone and must be armed again.

## What it never does

- **No domain knowledge.** The extension owns the cadence, the digest and the
  nudge. It holds no bead vocabulary, runs no tracker query, and invokes no `bd`.
  What the check reads and what its ids mean are the check's business.
- **No model call.** No prompt, no summarisation. One turn happens only because
  the delivered nudge starts one.
- **No message without a change.** Nothing announces a start, a stop, a failed
  tick, or a timed-out tick.
- **No held turn.** Arming schedules the first tick and returns; the first tick
  runs one interval later, so no child process ever runs inside the calling turn.
- **No `@earendil-works/*` value import.** Types only, so the staged install
  loads with pi absent from the extension's own `node_modules`
  (`test/pi-extensions-load.test.mjs` proves this). `typebox` is the one bare
  runtime import, and pi supplies it to extensions.
- **No change to `post-merge-watch`.** These are two extensions with two
  behaviours, and neither generalises the other. `post-merge-watch` polls one
  merge until it reaches a verdict, then wakes the session once. This extension
  returns before the wait and nudges on every change, for as long as the session
  lasts. A caller that wants a verdict wants the former; a caller that wants to
  hear about new work wants this one.

## Files

| File | What it holds |
| --- | --- |
| `index.ts` | The tool, the check resolution, the executor, the status text |
| `watch.ts` | The cadence, the digest, the nudge, and the status report |
| `watch.test.ts` | The mechanism: digests, changes, ticks, backoff, the session scope |
| `index.test.ts` | The wiring: registration, resolution, and each tool action |

## Development

```bash
pnpm test        # the cadence, the digest, the nudge, and the tool's wiring
pnpm typecheck   # tsc --noEmit
```

`watch.test.ts` drives the whole lifecycle with a scheduler it steps by hand and a
runner that returns scripted ticks, so no test sleeps or waits on a timer.
`index.test.ts` drives the extension through a complete-literal `ExtensionAPI`
double, which fails `tsc` when pi's interface grows a member.

To watch a stub end to end, point `AGENT_CORTEX_IDLE_WATCH_CHECK` at any script
that prints one JSON object whose id-bearing lists describe the work, and exits
`0`. Any other exit code means "could not look", and the watch stays silent.
