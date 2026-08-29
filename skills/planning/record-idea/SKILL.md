---
name: record-idea
description: Capture an early-stage idea into a structured backlog record with a short interview and validity check before any implementation planning. Use when the user says "capture this idea", "file this under ideas", or shares an idea that is "not ready to build".
---

# Record Idea

Capture an idea that is not implementation-ready into `docs/ideas/`, pressure-testing it with a short high-level interview so the backlog stores a direction, not a slogan.

## When to use

- The user shares a new idea and wants it written down without scoping it yet ("capture this idea", "file this under ideas", "get this out of my head").
- A discussion surfaces an idea that should not be planned today.
- Asked to "add this to the ideas backlog" or "record an idea".

## When NOT to use

- The idea is ready to build and needs a requirements document — run `write-a-prd` instead.
- The user wants an executable task created now — run `create-task` instead.
- The idea needs an end-to-end feature plan — run `plan` instead.

## Workflow

1. **Interview at a high level, one question at a time.** Ask what problem it solves and who benefits, how it might be done (rough approach only — no implementation detail), what would make it timely (triggers, dependencies, timing signals), and what priority it feels like relative to current work. Keep this short — it is a capture step, not a requirements session.

2. **Pressure-test briefly.** Challenge weak points such as scope, feasibility, and opportunity cost. The goal is a validity signal for the backlog, not a polished pitch.

3. **Choose the record shape.**
   - Simple idea: a single file `docs/ideas/<idea-name>.md`.
   - Complex idea: a folder `docs/ideas/<idea-name>/<idea-name>.md` with supporting docs alongside.

4. **Create the record file.** Run this skill's `scripts/new-idea.sh` helper with {{TOOL:bash}}:

   ```bash
   bash <skill-scripts>/new-idea.sh --title "<idea title>" [--complex]
   ```

   Resolve `<skill-scripts>` as the absolute path to this skill's own `scripts/` directory — it sits next to this `SKILL.md`, and the install location varies by harness, so do not hardcode a repo path. The script generates the scaffold, prints the file path, and errors if the file already exists or the title normalises to an empty slug.

5. **Fill the scaffold.** Write concise, decision-oriented content from the interview into every section — see `FORMAT.md` for the section list. Leave no `TODO`: the validity check specifically needs evidence, the riskiest assumption, and what would invalidate the idea.

6. **Report back.** Return the file path, a 2–3 sentence summary of the recorded idea, and the suggested priority with its likely timing signal.

## Red Flags

- Drifting into implementation detail during the interview — the record captures a direction, not a design.
- Skipping the pressure-test because the idea sounds good — weak points are cheapest to find here.
- Leaving scaffold `TODO`s unfilled — an incomplete validity check is no check at all.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "It's just an idea — write it down, don't interview me" | The two-minute interview is what makes the row reusable later; without it you store a slogan, not an idea. |
| "The user already knows what they want" | Knowing the direction is not the same as pressure-testing it. The validity check exists to catch what enthusiasm hides. |

## Philosophy / rationale

- **Capture before it becomes plan-shaped.** Scoping too early forces decisions the idea has not earned yet; a backlog note keeps the option open at minimal cost. The validity check is what stops the backlog from filling with confident, doomed ideas.

## Cross-skill references

- When an idea passes its validity check and becomes implementation-ready, run `write-a-prd` to scope it properly.
- For a full feature pipeline from idea to task breakdown, run `plan`.

## Examples

Input: "I keep accidentally committing secrets — capture that idea."
Output: `docs/ideas/secret-scanning-gate.md` — a filled idea record with a validity check, priority, and next validation step. See `FORMAT.md` for the scaffold sections.

## Verification checklist

- [ ] Interview covered who benefits, rough approach, timing, and priority.
- [ ] Idea was pressure-tested; weak points were challenged.
- [ ] Record file exists at `docs/ideas/<slug>.md` (script printed the path).
- [ ] Every scaffold section is filled — no `TODO` left in the record.
- [ ] Validity check records evidence, the riskiest assumption, and what would invalidate the idea.
- [ ] Record contains no implementation detail.
- [ ] Report returned the file path, summary, and suggested priority.