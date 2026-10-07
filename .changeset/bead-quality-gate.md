---
"@jaybeeuu/agent-cortex": minor
---

Bead quality gate: required sections now drive the planning interview, and every substantive
bead is validated at creation with `bd create --validate` and reviewed with `bd lint`.

- The type's required sections are documented once in `bd-tool` and referenced by the
  interview-driving skills (`write-a-prd`, `request-refactor-plan`, `prd-to-tasks`, `plan`,
  `ralph-plan`) and the grilling primitives (`grill-me`, `grill-with-docs`). Planning is complete
  only when there is enough agreed detail to fill every required section, and agents must confirm
  inferred answers with the human instead of inventing them.
- Substantive `bd create` calls carry `--validate`; each bead-creating flow runs a scoped
  `bd lint` review and fixes flagged beads.
- Templates now satisfy the contract: PRD and `prd-to-tasks` epics carry `## Success Criteria`;
  the refactor and architecture templates, the PR gate, and the ralph-plan planning gates carry
  `## Acceptance Criteria`. Chore beads stay exempt and instead point at the parent requirements
  bead.
- The stateful fake `bd` test helper models `--validate`, with tests covering rejection of a
  section-less bead and the PR gate's validated status.
