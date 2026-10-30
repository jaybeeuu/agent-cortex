---
name: record-idea
description: Capture an early-stage idea as a `kind:idea` bead with a short, validity-checking interview. Use when the user says "capture this idea", "file this under ideas", or shares an idea that is "not ready to build".
---

# Record Idea

Capture an idea that is not implementation-ready as a `bd` bead labelled `kind:idea`, pressure-testing it with a short high-level interview so the backlog stores a direction, not a slogan. The bead is the record: it is searchable, prioritised, syncable, and promotable in place.

## When to use

- The user shares a new idea and wants it written down without scoping it yet ("capture this idea", "file this under ideas", "get this out of my head").
- A discussion surfaces an idea that should not be planned today.
- Asked to "add this to the ideas backlog" or "record an idea".

## When NOT to use

- The idea is ready to build and needs a requirements document — run `write-a-prd` instead.
- The user wants an executable task created now — run `create-task` instead.
- The idea needs an end-to-end feature plan — run `plan` instead.
- An idea bead already exists and needs deepening or promoting — run `flesh-out-idea` instead.

## Workflow

1. **Interview at a high level, one question at a time.** Ask what problem it solves and who benefits, what outcome it would deliver (capability level, not implementation), what would make it timely (triggers, dependencies, timing signals), and what priority it feels like relative to current work. Default the priority to P4 (backlog) unless the user says otherwise.

2. **Pressure-test briefly.** Challenge weak points such as scope, feasibility, and opportunity cost. The goal is a validity signal for the backlog, not a polished pitch.

3. **Ask the implementation questions — bounded, then stop.** After the high-level pass, ask these three, because they are cheap now and expensive to reconstruct later:
   - **Rough mechanism** — what shape would this take (skill, extension, agent, script, convention, …)?
   - **Known constraints or tradeoffs** — anything already spotted that would shape it?
   - **Existing design thoughts** — anything already designed, sketched, or ruled out?

   Follow up adaptively at most twice, and only when an answer opens a thread worth pulling. The
   off-ramp is explicit: at any point "enough — record it" ends the interview and the answers so
   far become the record. "Not considered yet" is a recorded answer, not a prompt to dig. This is
   capture, not solutionising: the moment the conversation drifts into implementation detail,
   record what you have.

4. **Create the idea bead.** One `bd create` is the whole record — no files, no scaffold script:

   ```bash
   bd create "Idea: <title>" \
     -l kind:idea,execution:hitl \
     -p <P0-P4> \
     -d "<## Problem, ## Who benefits, ## Proposed outcome>" \
     --design "<## How we might do it>" \
     --notes "<## Validity check, ## Constraints, ## Next validation step, ## Design so far / provenance>" \
     --acceptance "<what would make this idea promotable>" \
     --validate --silent
   ```

   Keep the `##` markers inside each field — `flesh-out-idea` finds and updates sections by marker. `kind:idea` marks it as an unscoped idea and `execution:hitl` keeps it out of agent-workable queries. `--acceptance` carries the promotion criteria and satisfies the required-section gate for a `task` bead, so the record lints clean. See `FORMAT.md` for the field mapping and the content each section needs.

5. **Verify the record.** `bd show <id>` to confirm the fields landed, and `bd lint <id>` to confirm no section is missing. Fix anything the lint flags before reporting.

6. **Report back.** Return the bead ID, a 2–3 sentence summary of the recorded idea, and the suggested priority with its likely timing signal.

## Red Flags

- Drifting into implementation detail during the interview — the record captures a direction, not a design.
- Chasing an adaptive follow-up past two rounds, or past the user's "enough" — capture that stalls stops being capture.
- Skipping the pressure-test because the idea sounds good — weak points are cheapest to find here.
- Writing the idea into a markdown file instead of a bead — the bead is the record; a file is
  invisible to `bd` queries and dies outside the backlog.
- Leaving a section that carries no information — record "not considered yet" rather than deleting the marker.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "It's just an idea — write it down, don't interview me" | The two-minute interview is what makes the bead reusable later; without it you store a slogan, not an idea. |
| "The user already knows what they want" | Knowing the direction is not the same as pressure-testing it. The validity check exists to catch what enthusiasm hides. |
| "The implementation questions are premature for an idea" | Three questions are cheaper now than a re-interview later, and they seed the provenance section the flesh-out pass reads. |
| "I'll skip `--acceptance` and fill it in later" | The record is a `task` bead: without it `bd lint` flags the idea and the promotion bar is undefined. |

## Philosophy / rationale

- **Capture before it becomes plan-shaped.** Scoping too early forces decisions the idea has not earned yet; a backlog bead keeps the option open at minimal cost. The validity check is what stops the backlog from filling with confident, doomed ideas.
- **One home for backlog state.** Ideas live in `bd` next to the tasks and epics they become, so priority, dependencies, and search work the same way at every stage and promotion is a label change rather than a migration.

## Cross-skill references

- To deepen a recorded idea, update its sections, or promote it to an epic with task children, run `flesh-out-idea`.
- When an idea passes its validity check and becomes implementation-ready, run `write-a-prd` to scope it properly.
- For a full feature pipeline from idea to task breakdown, run `plan`.

## Examples

Input: "I keep accidentally committing secrets — capture that idea."

Output: `bd create "Idea: secret-scanning gate" -l kind:idea,execution:hitl -p 3 … --silent` → bead `proj-a1b2` — description holds the problem, who benefits, and the proposed outcome; `--design` the rough mechanism (a pre-commit hook); `--notes` the validity check, constraints, next validation step, and provenance; `--acceptance` the bar for promotion. See `FORMAT.md` for the full field mapping.

## Verification checklist

- [ ] Interview covered the problem, who benefits, rough mechanism, timing, and priority.
- [ ] Idea was pressure-tested; weak points were challenged.
- [ ] Implementation questions were asked, with at most two adaptive follow-ups.
- [ ] A `kind:idea` + `execution:hitl` bead exists (`bd show <id>` confirms both labels).
- [ ] Description, `--design`, `--notes`, and `--acceptance` carry their `##` section markers.
- [ ] `bd lint <id>` is clean.
- [ ] Record contains no implementation detail beyond the recorded mechanism thoughts.
- [ ] Report returned the bead ID, summary, and suggested priority.
