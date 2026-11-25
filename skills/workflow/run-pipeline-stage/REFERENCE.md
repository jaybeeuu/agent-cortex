# Parent Settlement

`close-settled-parent.mjs` closes a parent feature bead. The `post-merge` and `housekeeping`
playbooks call it, and it is the only writer that closes a parent. It decides from the bead graph
alone, so two runs form one ledger, and a finished chain always ends `closed`.

This file records why the parent has no other owner, which labels count as a merge, and what each
verdict means.

## Who closes the parent

A parent bead holds stage chores as children: `code` → `verify` → `review` → `document`, then the
HITL gate (`lifecycle:feature-pr`), then `post-merge` and `housekeeping`.

The stage that finishes the code cannot close the parent. At `document`, the gate and both later
chores are still open, so `bd close <parent-id>` refuses with `N open child issue(s)`. The gate is
the separate child it is because a human merges the PR.

The orchestrator (`ralph`) must not close it either. Ralph routes: it claims, dispatches and reads
reports. A close asserts that the work is finished and merged, which is a decision about completion,
not a dispatch. Ralph holds the job list in memory, so a close it wrote on a partial view asserts a
fact it did not check. The ownership split in `SKILL.md` already forbids the orchestrator from
writing a leaf bead, and a parent close is the same write one level up.

So the last two stages own the close, because both run after the human closes the gate. They share
one deterministic script instead of each judging the graph, so the verdict is the same whichever
stage runs last and no run depends on a model's opinion.

One alternative was rejected: letting `housekeeping` alone close the parent. That stage can end
`BLOCKED` and leave its chore open, and the parent would then have no closer at all. A second was
rejected: closing from the orchestrator at the human-action pause, for the reason above.

## What counts as merge evidence

The parent closes when every child is closed **and** at least one closed child carries one of these
labels:

| Label | Set by | What the closed child records |
| --- | --- | --- |
| `lifecycle:feature-pr` | `create-task`, closed by a human | a human merged the feature PR |
| `lifecycle:post-merge` | the `post-merge` stage in `pipeline.json` | the merge commit's CI run passed |
| `stage:post-merge` | the stage tag `trail-entry.mjs` uses | the same chore in a chain built by hand |

Only a **closed** child contributes evidence. An open gate records an unmerged PR, so it counts for
nothing, and a label on a parent counts for nothing: the script reads children only.

## The four verdicts

| Printed line | Meaning | Parent left | Exit |
| --- | --- | --- | --- |
| `closed <id>: all N children closed; merge evidence: <child> (<label>), …` | the chain settled | `closed`, with the evidence in its close reason | 0 |
| `skipped: children open — <id> (<child ids>)` | at least one child is not closed | open | 0 |
| `skipped: no merge evidence — <id> (…)` | every child is closed, none records a merge | open | 0 |
| `skipped: already closed — <id> (nothing to do)` | a previous run closed it | `closed`, unchanged | 0 |

A quiet run is a success, and every verdict except an error exits `0`. The two stages call the
script on every run, so a `skipped` line is the normal answer for most calls and nothing to escalate.
Exit `1` means a `bd` read or write failed. Exit `2` means the arguments were wrong. Report either
one, and never close the parent by hand to make the report look finished.

The script writes its note — `close-settled-parent: all N children closed; merge evidence: …` — to
the parent's trail *before* it closes, so the trail names the writer, the time and the evidence.

## Why `skipped: no merge evidence` keeps the parent open

A closed bead asserts that its work is done. For a feature parent, done means merged, and the only
record of a merge is a label a human or the post-merge check wrote on a child.

A parent whose children were all closed by hand — a chain abandoned mid-run, a feature folded into
another change, a chore closed to tidy the board — carries no such label. Closing it would assert a
merge that nothing recorded, and the tracker would then show a shipped feature that never shipped,
or hide a merge nobody made. The script refuses that claim, prints `skipped: no merge evidence`, and
leaves the parent for a human. That line is the honest answer, so a stage reports it and closes
nothing.

## The shapes the gap took

The gap was observed four times in one pipeline, each time in a different shape. Shapes 1–3 are what
this script answers; shape 4 follows from the third.

1. **A gate nobody closes.** The pipeline closes its own chores, but `lifecycle:feature-pr` is a
   human's bead, and a forgotten gate leaves the parent with an open child for ever. The script makes
   the human's action the merge and the gate close alone: the parent then closes on the next run
   without a second request.
2. **A blocked post-merge nothing retries.** The check found a red run and its chore stayed open, as
   its playbook requires. No machinery re-ran it after the cause was fixed, so the parent stayed
   `in_progress` for a reason that no longer held. The script reads the graph at every call, so the
   re-run that passes closes the parent on its own.
3. **A parent nobody closes once every child is done.** Every child closed, the parent still read
   `in_progress`, and a human closed it by hand or not at all. This is the shape the script exists
   for: a settled chain now ends `closed` with no human `bd close`.
4. **A merged feature whose worktree the pruner keeps skipping.** The pruner keeps a worktree whose
   bead does not read `closed`, and reports it as `open-bead`. A merged feature with an open parent
   therefore kept its worktree until someone noticed. Once the parent reads `closed`, the next
   housekeeping run removes it — report the first pass as `kept` and leave it alone.
