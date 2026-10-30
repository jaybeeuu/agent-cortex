---
name: flesh-out-idea
description: Deepen an idea bead through an interview, then update its fields or promote it to an epic with task children. Use when the user asks "flesh out an idea", "which ideas are ready", or "promote this idea".
---

# Flesh Out Idea

Take an idea recorded as a `kind:idea` bead and deepen it until it is either ready to promote or
explicitly still waiting on something. The bead is the record throughout: deepening rewrites its
fields, promotion changes its labels and type in place.

## When to use

- The user wants to work on the idea backlog ("flesh out an idea", "which ideas are ready?").
- An idea bead has stalled — its sections are thin, or its validity check has open questions.
- An idea looks ready to become an epic and needs the promotion step.

## When NOT to use

- The idea is not yet recorded — run `record-idea` first; deepening an unrecorded idea loses it.
- The idea is already an epic or a task bead — update it directly, or run `create-task` for
  pipeline expansion.
- The work is already understood and needs a requirements document — run `write-a-prd`.

## Workflow

1. **List candidates.** Query the blocker-aware ready view scoped to ideas:

   ```bash
   bd ready -l kind:idea
   ```

   `bd ready` respects dependencies, so an idea that `depends-on` in-flight work does not appear
   until that work closes. Use `bd list -l kind:idea` when you need every idea including blocked
   and deferred ones. If the user named a bead, skip straight to step 2.

2. **Read the current record.** `bd show <id> --json` — note which `##` markers already carry
   content and which are empty. Deepening fills gaps and challenges weak sections; it does not
   restart the capture interview from scratch.

3. **Interview at depth, one question at a time.** Push past the capture-level answer:
   - **Why** — what problem, and what evidence says it is real? What breaks if it is never done?
   - **Who** — who benefits, and how would they notice the improvement?
   - **How** — what shape would the implementation take, what alternatives were considered, and
     which tradeoffs decide between them?
   - **When** — what has to be true or landed first? Which dependencies gate it?
   - **Priority** — where does it now sit relative to current work (P0–P4)?

   Sharpen the validity check while you go: the riskiest assumption, the signal that would
   invalidate the idea, and the cheapest next step that would firm it up.

4. **Write the answers back into the bead.** Preserve the `##` markers — they are how the next
   round finds each section. Append notes rather than replacing them so interview rounds
   accumulate, and correct description or design in place when an answer supersedes what is there:

   ```bash
   bd update <id> --design "<## How we might do it …>" \
                  --append-notes "<## Validity check …>" \
                  -p <P0-P4>
   ```

   Use `-d/--description` to rewrite the problem, beneficiaries, or outcome, and `--acceptance` to
   restate the promotion criteria once the interview settles what "ready" means.

5. **Decide readiness against the acceptance criteria.** Read `--acceptance` and check it against
   what the interview established:
   - **Met** → go to step 6, or stop if the user only wanted deepening.
   - **Not met** → stop here. Record the blocking question and the next validation step in
     `## Next validation step`, and leave the bead open. An idea promoted before its bar is met
     produces children nobody can execute.

6. **Promote (optional, user-confirmed).** Turn the idea bead into the epic node and hang
   execution children off it:

   ```bash
   # the idea becomes the epic; it stays execution:hitl — a human owns the epic
   bd update <id> --add-label kind:epic --remove-label kind:idea -t epic

   # each executable child is agent-routable and inherits nothing from the epic
   bd create "<child title>" --parent <id> -l execution:afk --no-inherit-labels -t task \
     -d "<child description>" --validate
   ```

   `--parent` expresses ownership; `bd dep add <child> <blocker>` expresses ordering. Where a
   feature needs planning before implementation, create a planning bead and make the
   implementation children depend on it — the dependency, not a label, is the readiness gate. Run
   `create-task` instead when the children need pipeline stage chores.

7. **Report back.** Return the bead ID, what changed (sections rewritten, priority moved,
   children created), and either the promotion result or the specific reason it is not ready.

## Red Flags

- Promoting on enthusiasm while the acceptance criteria are still unmet — the children inherit a
  decision nobody made.
- Replacing notes instead of appending — the interview trail is the provenance the next round reads.
- Dropping the `##` markers while writing a field — the next flesh-out pass cannot find the section.
- Restarting the capture interview instead of challenging the existing record.
- Rewriting the idea as a markdown file — the bead is the record at every stage.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "The idea is obviously good, skip to promotion" | Promotion is the moment the idea spends other work's time; the acceptance criteria are the cheapest gate it will ever have. |
| "I'll remember the interview detail" | Only what lands in a field survives the session. Append it. |
| "The description is close enough, I'll just add a note" | Superseded description text misleads the next reader; correct it in place and keep the note for provenance. |
| "Adding children now saves a round trip" | Children created before the bar is met are the round trip — they get rewritten or closed. |

## Philosophy / rationale

- **An idea earns its children.** Promotion is cheap and reversal is not, so the interview
  pressure-tests the idea until its own acceptance criteria say it can be executed. Everything
  before that is one bead getting better.
- **Two axes, one hierarchy.** Ownership is `--parent`; ordering is a dependency. Keeping them
  separate means the readiness view answers "what can be worked now?" without a second label
  scheme.

## See Also

- [record-idea](../record-idea/SKILL.md) — load to capture a new idea instead of deepening an existing one.
- [create-task](../create-task/SKILL.md) — load when a promoted epic needs pipeline-stage chores.
- [write-a-prd](../write-a-prd/SKILL.md) — load when the deepened idea is ready for requirements capture.
- [bd-tool](../../productivity/bd-tool/SKILL.md) — load for label vocabulary and queries beyond the commands used here.

## Examples

Input: "which ideas are ready?" → `bd ready -l kind:idea` lists three; the user picks one whose
acceptance criteria name a prototype result.

Output: the interview settles the mechanism and the two tradeoffs that decide it; `--design` and
`--notes` are updated with the markers preserved, priority moves from P4 to P2, and the bead is
promoted (`kind:epic`, `-t epic`) with two `execution:afk` children created via `--parent`. See
`REFERENCE.md` for the full worked promotion.

## Verification checklist

- [ ] The candidate list came from `bd ready -l kind:idea` (or the user named the bead).
- [ ] The existing record was read before the interview started (`bd show <id> --json`).
- [ ] Every `##` marker present before the update is still present after it.
- [ ] Notes were appended, not replaced; superseded description or design text was corrected.
- [ ] Priority reflects the interview (`bd show <id>` confirms it).
- [ ] On promotion: label is `kind:epic`, type is `epic`, and `kind:idea` is gone.
- [ ] On promotion: every child carries `execution:afk` and no inherited epic label.
- [ ] On no promotion: `## Next validation step` records what would unblock it.
- [ ] Report returned the bead ID, the changes, and the promotion outcome or blocker.
