---
name: hitl-collab
description: Coordinates human-in-the-loop collaboration by writing a handoff document for a human reviewer and linking it from the bead. Use when a task needs human review or approval, manual steps agents cannot run, or a PR handoff — e.g. "hand this to a human", "what does the reviewer need", or "prepare the manual test run".
---

# HITL Collab

## When to use

- Preparing a task handover where the next actor is a human, not an agent.
- The bead's acceptance criteria depend on reviewer judgment or steps only a human can run — sign-off, credentials, device access.
- A PR is ready and needs a human to test, review, and merge.
- You need durable context for a reviewer: what changed, what to run, and what to check.

## When NOT to use

- The reader is another agent — use `handoff` to compact the conversation instead.
- No human gate exists and agents can verify and close the work themselves — run the pipeline directly with `run-pipeline-stage`.
- You only need bead bookkeeping or task state — use `bd-tool` instead.

## Workflow

1. Confirm the bead and its HITL gate with `bd show <bead-id>` (ID required). Pull PR/branch links, acceptance criteria, and any manual steps from the task description.
2. Write `.agent-cortex/working-docs/hitl/<bead-id>/handoff.md` using the handoff doc template below. Follow `style-comms` for tone and structure.
3. Keep supporting material — screenshots, logs, reproduction scripts — in the same `.agent-cortex/working-docs/hitl/<bead-id>/` directory; it is the collaboration home the reviewer works from.
4. Link the doc from the bead only when the bead is missing PR/branch links, manual steps, or acceptance criteria. Append — never replace: `bd update <bead-id> --append-notes "<doc path + missing details>"`. The plain `--notes` flag overwrites existing notes and would silently destroy prior context.

## Handoff doc template

Use these sections in this order, adapting headings to the task:

- **Summary** — one paragraph: what was built, its state, what remains.
- **Why HITL** — the gate that requires a human (approval, manual steps, judgment).
- **PR/branch links** — where the reviewer starts.
- **Acceptance criteria** — copied from the bead so the review is checkable.
- **Manual steps** — copy-runnable commands and actions for the human.
- **Verification checklist** — what the reviewer must confirm before signing off.
- **References** — optional links to specs, PRDs, ADRs.

## Red Flags

- Guessing the bead ID instead of running `bd show` — the doc lands in the wrong directory and the wrong task gets reviewed.
- Using `--notes` when the bead already carries notes — it replaces them; `--append-notes` preserves them.
- Writing the doc outside `.agent-cortex/working-docs/hitl/<bead-id>/` — it is lost when the worktree is discarded and downstream agents cannot find it.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "The human is in the room — no doc needed" | The doc is the durable record the reviewer works from; an in-session chat disappears when the session ends. |
| "The PR description already covers it" | The PR shows the diff, not the review protocol: what to run, what to check, and how to sign off. |
| "I'll compress everything into one bead note" | Notes are metadata. Manual steps and acceptance criteria belong in the doc where they survive and can be checked off. |

## Philosophy / rationale

- **Docs are the durable artifact; bead updates are pointers.** The document outlives the session and the worktree, so the human gate always has a stable review surface. The bead carries only what routing needs — links and the doc path.

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| Tone, structure, and concision for the doc | `style-comms` |
| Conversation compaction for another agent | `handoff` |
| Bead discovery, queries, and state updates | `bd-tool` |

## Examples

### Handoff doc skeleton

```md
# Handoff — agnt-ctx-123456
## Summary
Implemented X; tests pass; PR open.
## Why HITL
Needs sign-off on the API contract change.
## PR/branch links
- PR: https://github.com/jaybeeuu/agent-cortex/pull/42
- Branch: feature/agnt-ctx-123456
## Acceptance criteria
- [ ] Contract change approved by reviewer
## Manual steps
1. `pnpm install && pnpm test`
2. `pnpm build:claude && git diff --stat claude/`
## Verification checklist
- [ ] Tests pass locally
- [ ] Generated output up to date
## References
- PRD: docs/prds/api-contract.md
```

## Verification checklist

- [ ] `bd show <bead-id>` confirmed the bead and HITL gate in scope
- [ ] Handoff doc written to `.agent-cortex/working-docs/hitl/<bead-id>/handoff.md`
- [ ] Doc covers Summary, Why HITL, PR/branch links, Acceptance criteria, Manual steps, and Verification checklist (References only where useful)
- [ ] Manual steps are commands a human can copy and run, not prose hints
- [ ] Bead notes include the doc path and any missing PR/branch links, manual steps, or acceptance criteria
- [ ] Existing bead notes preserved — used `--append-notes`, not `--notes`