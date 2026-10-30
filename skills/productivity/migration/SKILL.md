---
name: migration
description: "Migrate a beads workspace to the two-axis model via the versioned `agent-cortex migrate` command: dry-run, apply, verify, recover. Use when asked to \"run the migration\" or \"rename the labels\"."
disable-model-invocation: true
---

# Migration

Bring a beads workspace up to the current workflow model by running the versioned
`agent-cortex migrate` command in that workspace. From a checkout that is not installed, the same
command is `node bin/agent-cortex.mjs migrate` — those are the only two invocations. The command
keeps an ordered registry of steps, detects the version a repo is at, and applies each step in
order until the repo is current — the same command migrates every workspace, whenever it joins.

Steps are **dry-run by default**, **idempotent**, and **verified per step**. Your job is to
plan, gate, and prove the run — never to hand-edit `.beads/` or a label list.

Steps in flight (full contract in `REFERENCE.md`):

| Version | Step | Effect |
|---|---|---|
| v1 | Label rename | `implementation-type:afk\|hitl` → `execution:afk\|hitl`, all beads including closed |
| v2 | Ideas → beads | `docs/ideas/*.md` files become `kind:idea` beads (`--dir` overrides the source) |

## When to use

- A workspace's beads still carry `implementation-type:afk|hitl` and must move to `execution:*`.
- The user says "run the migration", "rename the labels", "migrate this repo", or asks why
  `bd ready -l execution:afk` returns nothing in a project that clearly has AFK work.
- A repo adopts agent-cortex (or a newer version) and its existing beads predate the model.
- Loose idea markdown is being retired in favour of `kind:idea` beads (step v2).

## When NOT to use

- No `.beads/` in the workspace — initialise it first with the `init-beads` skill; there is
  nothing to migrate.
- The migration command is absent from the installed `agent-cortex` — upgrade the package
  instead of hand-running steps. The only exception is the documented manual fallback in
  `REFERENCE.md`, used when a fix is needed on a pinned version.
- The repo's skills and routing queries still create and filter the *old* labels. Land those
  updates first: renaming under a ralph that queries `implementation-type:afk` leaves the
  workspace unroutable. Order the sequence; do not race it.

## Workflow

1. **Preflight.** Run `bd version`, `bd label list-all`, and `agent-cortex --help` (upgrade the
   package if `migrate` is not listed). The command is `agent-cortex migrate`; if the CLI is not
   on PATH, run it from the package checkout as `node bin/agent-cortex.mjs migrate`. Read
   `agent-cortex migrate --help` for the flags this build accepts. Act on the version the registry
   detects — do not infer it yourself.

2. **Snapshot before touching anything.** `bd export --all -o <path>.jsonl` (JSONL of every issue
   including closed, with labels and dependencies). `--all` also exports infrastructure beads,
   templates, gates, and `bd remember` memories, so keep the file outside the repo or gitignored —
   see _Snapshot scope_ in `REFERENCE.md`. This is the rollback source of truth; keep it until the
   post-checks pass.

3. **Dry run.** Run the command with no apply flag — dry-run is the default, and an explicit
   `--dry-run` is equivalent. It writes nothing and exits 0. Read the plan it prints: the
   workspace version against the latest, then the **first pending step** only — its name, one
   line per pending bead naming the labels it would gain and lose, the pending bead count, and
   the no-writes notice. Steps behind a pending one are not named, and the plan does not group
   beads by label value — take group sizes from the export counts in step 4.

4. **Gate on the plan.** Apply only when all of these hold:
   - The detected version and the steps to run match what you expect for this repo.
   - Every `implementation-type:<value>` group maps to exactly one `execution:<value>` group.
   - Group sizes reconcile with the legacy-label counts in `bd export --all` — the source the
     command itself reads. A bead carrying both labels appears in both groups — expected, not a
     conflict. Do not reconcile with `bd list --label-pattern` (see `REFERENCE.md`).
   - No unmapped or novel label value: the rename is strict and only `afk|hitl` are mapped, so
     the command refuses the whole run — dry run and `--apply` alike, nothing written — naming
     each offending bead and label. Treat that error as a signal to inspect, not to work around.

5. **Apply.** Run the same command with `--apply`. Steps write in batches per label value —
   add the `execution:<value>` label, then remove the `implementation-type:<value>` label — so a
   partial failure never loses the routing label. Record the summary verbatim in your report.

6. **Post-check.** Treat the migration as unproven until all of these hold:

   ```bash
   bd label list-all                              # no implementation-type:* remains
   bd export --all | grep '"implementation-type:' # empty, closed beads included
   bd ready -l execution:afk                      # same beads as the pre-migration AFK set
   ```

   Then grep the repo for stale `implementation-type` references (skills, docs, hooks, configs).
   List the files still to update — they are follow-up work, not part of the rename.

7. **Prove idempotence.** Re-run the dry run. A converged repo plans zero targets, performs no
   writes, and exits 0. A non-empty plan after `--apply` means the write step did not converge:
   investigate before applying again.

8. **Recover if needed.** A dry run that wrote nothing is the normal failure mode. For a
   half-applied step, an inverted rename, or a bad plan, follow _Rollback and recovery_.

9. **Continue the sequence.** The label rename is one step, not the migration. Idea files become
   beads at a later step, and any skill, hook, or doc that creates or queries the old labels
   must be updated before the workspace is truly current. Hand those edits to their owners; the
   migration command does not rewrite prose.

Workflow at a glance:

```text
[Preflight: bd + command]
          |
          v
[Snapshot: bd export --all]
          |
          v
[Dry run: read plan] --(plan unexpected)--> [Stop: no writes]
          |
    (plan matches)
          v
     [Apply --apply]
          |
          v
[Post-check 4 gates] --(fail)--> [Invert per group]
          |
        (pass)
          v
[Re-run dry run: no-op] --> [Hand off stale refs + later steps]
```

## Rollback and recovery

- **Nothing applied yet** — the dry run wrote nothing, so discard the plan; the workspace is
  untouched; the snapshot is not even needed.
- **A step died mid-batch** — dry-run, then re-run `--apply`: steps are idempotent per group, so
  already-renamed beads no longer match and the retry resumes instead of repeating writes.
- **A completed step was wrong** — invert it per group from the recorded plan or pre-migration
  export: `bd label add <ids…> implementation-type:<value>` then
  `bd label remove <ids…> execution:<value>` (issue ids first, label last), through `bd`, never
  by editing `.beads/` files.
- **Unsure which groups moved** — diff the pre-migration export's label sets against
  `bd export --all` now. Recipes and shared-workspace cautions are in `REFERENCE.md`.

## Rationale: why the rename exists

The workspace runs on two independent axes: **bead type** (`idea → epic → feature → chore`,
what shape the work has) and **execution** (`execution:afk` = agent-routable, `execution:hitl` =
human required). Hierarchy is ownership via `--parent`; ordering is `depends-on`, which alone
gates readiness. `implementation-type:` collapsed the two axes and named one particular executor,
which is why routing broke when the executor changed; `execution:` is agent-agnostic and is the
exact value ralph queries (`bd ready -l execution:afk`). That is also why the rename is strict:
the label *is* the query, so a half-migrated workspace does not error — it silently starves, and
the queue looks empty instead of broken. Hence snapshot → dry run → gated apply → post-check.

## Cross-skill references

- `bd-tool` — bead query and label conventions the migration's post-checks rely on.
- `init-beads` — create the `.beads/` workspace before a first migration.
- `classify-bead` — the skill that applies `execution:*` labels to new beads after migration.
- `ralph` — the consumer of `execution:afk`; its query is the migration's smoke test.

## Verification checklist

- [ ] `bd version` and `agent-cortex migrate --help` both ran; the flags this build accepts are known.
- [ ] A pre-migration `bd export --all` snapshot exists and is readable.
- [ ] The dry run reported a plan and wrote nothing (no label changes in `bd label list-all`).
- [ ] The plan reconciles with the legacy-label counts in `bd export --all`.
- [ ] The `--apply` summary is recorded verbatim: one line per step with its pending bead total
      and a `verified` line. It reports no per-group counts — reconcile group sizes against the
      step-4 export counts.
- [ ] `bd label list-all` and the export grep in step 6 both show nothing left.
- [ ] `bd ready -l execution:afk` returns the same beads as the pre-migration AFK set.
- [ ] A repeat dry run is a no-op (zero targets, exit 0).
- [ ] Stale `implementation-type` references are listed with their owning files, and later steps
      (idea files → beads) plus skill/doc updates are handed off explicitly.
