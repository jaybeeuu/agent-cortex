---
"@jaybeeuu/agent-cortex": patch
---

Make stage chores pre-created only and add ralph's expansion guard. `create-chores.ts` already
builds the whole `pipeline.json` chain with `blocks` deps, so the ralph agent body and the
`ralph` skill no longer create a chore on success paths or at first dispatch — they dispatch
whatever `bd ready` returns. A ready AFK task bead with no `stage:*` chore children is expanded
first by a worker running `create-chores.ts --parent <id> --priority <parent-priority>`, whose
returned `code`/`verify`/`review`/`document`/`featurePrReview` mapping is reported before the
normal dispatch picks up `stage:code`; the guard names the duplicate-parent hazard of re-running
`create-task` for an existing bead. `create-task` documents expanding an existing bead as a
supported entry point.

An expansion worker has its own completion contract: it is recorded in `state.json`'s `inflight`
as `"kind": "expand"` with `choreId: null` (stage dispatches are `"kind": "stage"`), emits no
`---REPORT---`, and owns no bead to close — its completion means "the parent now has a `stage:*`
chain", so ralph confirms the chore tree exists and dispatches the ready `stage:code` chore. The
PI wait set and the Copilot timer start, HITL-pause check, and shutdown check all cover expansion
workers, so an in-flight expansion no longer looks like idle work and can no longer trigger HITL
Pause or Shutdown mid-expansion.

Every in-flight query now derives from `state.json`'s `inflight` instead of a
`--type=chore` beads listing: the dispatch cap counts parents with an `inflight` entry (stage or
`expand`), Log Polling tails the log of every `inflight` entry's `parentId`, and the Copilot
HITL-pause check, ralph's Shutdown condition, and the REFERENCE _What is in-flight?_ row all read
`inflight` — so a running expansion worker occupies a slot and is polled like any other worker.

That rule is now stated as an invariant and applied to every ralph control-flow predicate, not
just the ones an earlier round happened to touch: **every ralph predicate — is anything in flight,
is there work, is there room under the cap, may we pause, may we shut down — derives from
`state.json`'s `inflight` (`kind: stage|expand`) plus `bd ready`, never from a chore-type `bd`
query.** REFERENCE.md gains a _The in-flight invariant_ section with the derive-it-from /
never-from table, and the skill's init hand-over no longer gates on "no chore was dispatched"
(an expansion-only init is in flight, not idle, so it can no longer jump to HITL Pause
mid-expansion). The remaining chore-only predicates were widened at the same time: the init
hand-over, the HITL-pause conditions (agent body, skill, REFERENCE, Copilot poll tick), and the
Shutdown conditions now require that nothing is *dispatchable* — no ready `stage:*` chore **and**
no chore-less AFK task bead awaiting expansion — instead of only "no stage chores are ready".
`agents/ralph/claude/polling.md` is marked explicitly unused: `bin/installers/claude.mjs` DEFERs
`ralph` to `agents-native/ralph.md`, so nothing composes it; its completion-handling text is
nonetheless aligned to the same `kind` branch so the harness-neutral wake-section work can revive
it without reintroducing the chore-only predicate, and `agents/README.md` says so in the ralph
layout.
