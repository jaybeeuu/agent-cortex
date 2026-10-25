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
