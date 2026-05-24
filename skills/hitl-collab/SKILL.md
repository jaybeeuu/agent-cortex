---
name: hitl-collab
description: Coordinates HITL collaboration by producing a handoff document and optionally updating the HITL bead with a summary and doc link. Use when a task requires human review/approval, manual steps, or PR handoff collaboration.
---

# HITL Collab

## Quick start

1. Run `bd show <bead-id>` (bead ID is required).
2. Create `.agent-cortex/working-docs/hitl/<bead-id>/handoff.md`.
3. If the bead lacks **PR/branch links + manual steps + acceptance criteria**, add a short note with those details and the handoff doc path via `bd update <bead-id> --notes "<text>"`.

## Handoff doc template

- **Summary**
- **Why HITL**
- **PR/branch links**
- **Acceptance criteria**
- **Manual steps**
- **Verification checklist**
- **References** (optional)

## Workflow

1. Gather context from the bead description and any referenced PRs/branches.
2. Write the handoff doc using the template above. Use the `style-comms` skill for tone.
3. Use `.agent-cortex/working-docs/hitl/<bead-id>/` as the home for any additional notes, scripts, screenshots, or logs needed for collaboration.
4. Only update the bead if it is missing **PR/branch links**, **manual steps**, or **acceptance criteria**. Include the handoff doc path in the note.
