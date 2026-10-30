# Migration reference

Contracts, step details, and recovery recipes for the `migration` skill. `SKILL.md` holds the
workflow and the gate; this file holds the detail you reach for while running it.

## Command interface the skill relies on

The command is shipped by the `agent-cortex` CLI (`bin/agent-cortex.mjs` + `lib/cli.mjs`), which
exposes exactly one executable name — `agent-cortex`. From a checkout that is not installed, run
it as `node bin/agent-cortex.mjs migrate`. There is no shorter alias. This skill depends on the
following behaviour — nothing wider:

| Contract | Guarantee the skill assumes |
|---|---|
| `agent-cortex migrate` | **Dry run is the default**: plans the first pending step only, zero writes, exit 0. With `--apply` it runs every step the repo still needs. |
| `--apply` | Performs the writes. Same plan, executed. |
| `--dry-run` | Explicit form of the default; identical output, still zero writes. |
| `--help` | Lists the commands and flags this build accepts, including whether `migrate` itself is present. |
| `--dir <path>` | Points step v2 at a workspace that keeps its idea files somewhere other than `docs/ideas`. Omitted, the default applies; a missing value is a usage error, not a silent fallback. |
| Idea source | Step v2 reads `*.md` under the idea directory (`docs/ideas/` unless `--dir` says otherwise), one level of nesting included, and never writes or deletes one. |
| Registry detection | Reports the repo's current version and the first step with pending work — the only step a dry run plans — derived from workspace state, not from a flag or a stored marker the agent has to keep. |
| Step ordering | Applies steps in version order, oldest first. The final summary is one line per step: its name and description, that step's pending bead total, and a `verified` line. It carries no per-group breakdown — derive group sizes from the step-v1 export counts. |
| Idempotence | A converged repo plans zero targets and exits 0; a re-run after a partial failure resumes rather than repeating writes. |
| Failure mode | Fails loudly (non-zero exit) when `bd` is missing or a `bd` subcommand errors; never silently skips a group. A v1 label value outside `afk\|hitl` is a blocking error that names each offending bead and label and stops before any write — both the dry run and `--apply` refuse. |

Read `agent-cortex migrate --help` in the target workspace before relying on any flag beyond the
above. The registry grows over time; treat the flags in this table as the floor, and the installed
build's help output as the truth. If `migrate` is not listed at all, the installed package predates
the command — upgrade rather than reconstructing the steps by hand.

Scope note: the command touches beads only. Skills, hooks, docs, and agent prompts that mention
the old labels are follow-up edits in the repo, not command output. Step v2 reads idea files and
never writes or deletes one — retiring the files is the repo's cutover, not the migration.

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

Step v2 adds two reads of its own, both cheap: the idea files on disk, and one `bd list -l
kind:idea --all --json --limit 0` for the records that already exist. It never runs the full
export.

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
agent-agnostic. Only those two values are mapped: any other value (`wip`, a typo, a value from a
future axis) is a blocking error naming the bead and the label, raised before any write, so the
run can never invent a label such as `execution:wip` that nothing queries.

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

Purpose: loose idea files (`docs/ideas/*.md`) become `kind:idea` + `execution:hitl` beads, one
bead per file. The files are read and left in place; deleting them is the repo's own cutover step.
The step is repo-agnostic — it assumes an idea directory (`docs/ideas/` by default, `--dir`
overridable) and nothing else: no skill, no install path, no agent-cortex-specific label.

Mechanics the plan reflects:

- **Discovery.** Top-level `*.md` under the idea directory, plus one level of nesting (a multi-part
  idea can live in its own folder). A missing directory is not an error — a workspace that never
  used idea files has nothing pending. The plan prints one line per file: path, title, priority.
- **Field mapping.** The files predate a single template, so a `##` heading is matched by normalised
  name (case-folded, trailing parenthetical ignored) rather than exact text. Every field keeps its
  `##` marker, because the marker is the contract `flesh-out-idea` reads a bead by.

  | Bead field | Sections |
  |---|---|
  | title | the `#` heading, `Idea: ` prefixed (a leading `Idea:`/`Design:` is not doubled) |
  | `--description` | `## Problem`, legacy `## Why it might be useful`, `## Who benefits`, `## Proposed outcome` |
  | `--design` | `## How we might do it`, `## Fleshed-out design (…)`, `## Design so far / provenance` |
  | `--notes` | `## Status`, `## Created`, `## Validity check`, `## Constraints`, `## Next validation step`, `## Priority`, `## When to think about it`, `## Open questions`, `## Notes`, and every unlisted `##` section in file order |
  | `--context` | unused — no idea file in the wild carries a referential section; do not invent one |
  | `--acceptance` | fixed promotion criterion: a scoped epic/feature is spawned from the bead, or it is explicitly rejected (a `task` bead needs acceptance criteria to lint clean) |
  | `-p` | first `P0`–`P4` token anywhere in the file, `P4` when the file states none |

  The invariant that makes the mapping checkable: **no content loss** — the heading becomes the
  title and every other line of the file appears in exactly one of the three fields.

- **Priority caveat.** The first `P<n>` token wins, so a file that only mentions a `P0-P4` *scale*
  reads as `P0`. Read the priority column of the plan before applying.

- **Labels.** `kind:idea` marks the record as an unscoped idea; `execution:hitl` is always applied
  because an idea is human-owned until promoted, and it stays out of the agent queue by *not*
  carrying `execution:afk`.

- **Idempotence.** Before creating anything the step reads `bd list -l kind:idea --all --json
  --limit 0` and skips a file when an idea bead already records it: either a bead names the file
  under a `## Provenance` heading, or a bead carrying no provenance has a matching title (after
  dropping the `Idea: ` / `Design: ` prefix and all punctuation). Every bead the step creates
  cites its source file under `## Provenance`, so the provenance rule is what makes a re-run, or
  an `--apply` that died part-way, a no-op — and what keeps two files that share a title
  (`task-session-context.md` and `task-session-context.local.md` do) separately attributable. The
  title rule is the fallback for records migrated by hand before the step existed, which cite no
  source; a title match is therefore also the one case where a summary bead can stand in for a
  file's content. A passing cross-reference outside a provenance section is not a record — the
  step still creates that bead.

- **Write order.** One `bd create --silent` per file, in path order, so a partial failure leaves
  only the unmigrated files behind; the verification pass re-detects and must find nothing.

Verify with `bd list -l kind:idea --json --limit 0`, then compare one bead's fields against its
source file before the files are retired ("files present but already migrated" is a normal state:
the plan simply has nothing to say about them).

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

For step v2 by hand, follow the field table under _Step v2 — ideas to beads_ and create one bead
per file:

```bash
bd create "Idea: <file title>" --silent -l kind:idea,execution:hitl -p P<n> \
  -d "<## Problem, ## Who benefits, ## Proposed outcome>" \
  --design "<## How we might do it>" \
  --notes "<## Status, ## Validity check, ## Constraints, ## Next validation step, …>" \
  --acceptance "<promotion criterion>"
```

Keep every `##` marker inside its field, check the title against `bd list -l kind:idea` before
creating — a hand-run has no collision skip — and leave the source files in place unless the repo
has already retired the file flow.

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
plan with the group sizes reconciled from the export (or, at v2, the per-file title and priority
lines), the `--apply` summary, the four post-check results, the idempotence re-run outcome, and the
stale-reference list with owning files. That sequence is also the evidence trail if a later
post-check fails.
