# Migration reference

Contracts, step details, and recovery recipes for the `migration` skill. `SKILL.md` holds the
workflow and the gate; this file holds the detail you reach for while running it.

## Command interface the skill relies on

The command is shipped by the `agent-cortex` CLI (`bin/agent-cortex.mjs` + `lib/cli.mjs`) and is
also exposed as `ctx migrate`. This skill depends on the following behaviour — nothing wider:

| Contract | Guarantee the skill assumes |
|---|---|
| `agent-cortex migrate` | **Dry run is the default**: plans the first pending step only, zero writes, exit 0. With `--apply` it runs every step the repo still needs. |
| `--apply` | Performs the writes. Same plan, executed. |
| `--dry-run` | Explicit form of the default; identical output, still zero writes. |
| `--help` | Lists the commands and flags this build accepts, including whether `migrate` itself is present. |
| Registry detection | Reports the repo's current version and the first step with pending work — the only step a dry run plans — derived from workspace state, not from a flag or a stored marker the agent has to keep. |
| Step ordering | Applies steps in version order, oldest first. The final summary is one line per step: its name and description, that step's pending bead total, and a `verified` line. It carries no per-group breakdown — derive group sizes from the step-v1 export counts. |
| Idempotence | A converged repo plans zero targets and exits 0; a re-run after a partial failure resumes rather than repeating writes. |
| Failure mode | Fails loudly (non-zero exit) when `bd` is missing or a `bd` subcommand errors; never silently skips a group. |

Read `<command> --help` in the target workspace before relying on any flag beyond the above. The
registry grows over time; treat the flags in this table as the floor, and the installed build's
help output as the truth. If `migrate` is not listed at all, the installed package predates the
command — upgrade rather than reconstructing the steps by hand.

Scope note: the command touches beads only. Skills, hooks, docs, and agent prompts that mention
the old labels are follow-up edits in the repo, not command output.

## Detection source and its cost

Detection and verification read `bd export --all`, cross-checked against `bd label list-all
--json`. A label-filtered `bd list` is not in the path: on bd 1.3.1 that query can omit closed
beads, which is how a half-migrated workspace once verified clean. The cross-check keeps the
export from becoming the new silent weak link — an export that cannot attribute a legacy label
the index still lists fails the run rather than shrinking the count.

The cost is operational. One `--apply` reads the whole export about three times — initial
detection, verification after the step, then re-detection for the next step — so a large workspace
pays for a full export per call rather than a label-filtered page. Each call is capped at 32 MB of
stdout (roughly 12k issues at typical record sizes); past the cap the run fails loudly instead of
truncating. Near the ceiling, expect that explicit failure and do not read a short result as a
clean workspace.

## Snapshot scope (SKILL step 2)

`bd export --all` is the pre-migration snapshot. It includes infrastructure beads (agents, roles,
messages), templates, gates, and `bd remember` memories as well as regular issues — so treat the
file as sensitive and keep it out of the repo (a path outside the workspace, or one you have
gitignored; `bd export --all -o <path>.jsonl` writes it directly). It is an issue export, not a
full database backup: Dolt branches, commit history, and working-set state are not captured. For
undoing a migration that is enough — steps change labels and dependencies, both of which the
export records.

## Step v1 — label rename

Purpose: `implementation-type:afk|hitl` → `execution:afk|hitl`, strictly renamed and
agent-agnostic.

Mechanics the plan reflects:

1. Enumerate every bead carrying an `implementation-type:*` label by reading the whole workspace —
   `bd export --all` (JSONL) — closed beads included, because a clean label space is the goal and
   bd tolerates label history on closed issues. There is no label filter and no page limit in this
   path, so the count is the workspace's rather than a query's.
2. Group bead ids by label value. A bead carrying both `afk` and `hitl` appears in both groups;
   that is a data problem worth inspecting, not a conflict the tool resolves for you.
3. Per group, on `--apply`: `bd label add <ids…> execution:<value>` then
   `bd label remove <ids…> implementation-type:<value>`. Add-then-remove keeps the routing label
   present at every instant, so nothing is unroutable mid-flight.
4. Re-running after convergence finds zero targets — the no-op that proves idempotence.

Verification commands:

```bash
bd label list-all                               # no implementation-type:* entries
bd export --all | grep '"implementation-type:'  # empty, closed beads included
bd label list <bead-id>                         # spot-check: execution:<value> present
bd ready -l execution:afk                       # the routing query still works
```

## Step v2 — ideas to beads

Purpose: retired loose idea files (`docs/ideas/*.md`, overridable with `--dir`) become
`kind:idea` beads.

Mechanics the plan reflects:

- Each file maps to one bead: the problem section becomes `--description`, the how section
  `--design`, the when/priority/validity/constraints/notes sections `--notes`, referential links
  `--context`. Section markers stay inside the fields so content fidelity survives the move.
- Priority is preserved from the file; a file with no stated priority becomes P4 (backlog).
- Beads are created with `-l kind:idea` and are always `execution:hitl`: an idea is human-owned
  until it is promoted, and it stays out of the agent queue by *not* carrying `execution:afk`.
- Deletion of the source files (and any scaffold script that writes them) happens only after the
  skills that create and consume them stop using the file flow — otherwise the repo regenerates
  what you just deleted. Land those skill updates first, then delete.

Verify with `bd list -l kind:idea --long`, checking one migrated bead's fields against its source
file before the files are removed.

## Rollback recipes

The pre-migration `bd export --all` snapshot plus the recorded dry-run plan is enough to undo any
step. Work per label group, oldest rename last, and re-verify with the v1 checks after each
inversion.

Every `bd label` call in this skill passes issue ids first and the label last, matching the CLI's
`bd label add [issue-id...] [label[,label...]]`. Reversing that order fails: the ids are resolved
before the trailing argument is read as a label.

```bash
# Invert the v1 rename for a specific group
bd label add <ids…> implementation-type:afk
bd label remove <ids…> execution:afk

# Confirm the inversion landed before touching the next group
bd list -l execution:afk --all
```

Rules that keep recovery safe:

- Drive every change through `bd`; editing `.beads/` files bypasses Dolt bookkeeping and produces
  a workspace that disagrees with its own history.
- Invert one group at a time and re-check. Whole-step inversion in one shot makes a partial
  mistake indistinguishable from a partial success.
- If the workspace is shared or synced (`bd dolt push` in use), say so in your report and pause
  for the human owner before inverting — other clones may already have observed the rename.

## Manual fallback (pinned version, no `migrate`)

Use only when the installed package genuinely lacks the command and an upgrade is out of scope.
Run exactly what v1 would run, with the same gate:

```bash
# Read the plan; confirm the group counts match what you expect
bd export --all | grep '"implementation-type:'   # every bead, closed included
bd label add <ids…> execution:afk
bd label remove <ids…> implementation-type:afk
bd label add <ids…> execution:hitl
bd label remove <ids…> implementation-type:hitl
bd label list-all                        # verify: nothing left
```

Then record in the handoff that the run did not go through the registry, so the repo still needs
a `migrate` dry run once the command is available (it will simply find nothing to do).

## Stale-reference sweep

The rename is not done while text still teaches the old label. Search the workspace for the old
name and route each hit to its owner:

```bash
grep -rn "implementation-type" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.beads
```

Classify each hit before editing: skill instructions and classifier logic (they apply labels),
routing queries in orchestration docs (they filter on labels), and historical records such as
changelogs, ADRs, or closed-bead notes (leave them — rewriting history removes the trail).

## Reporting a run

Record, in order: the detected version and steps planned, the snapshot location, the dry-run
plan with the group sizes reconciled from the export, the `--apply`
summary, the four post-check results, the idempotence re-run outcome, and the stale-reference list
with owning files. That sequence is also the evidence trail if a later post-check fails.
