# Changelog

All notable changes to this repository are documented in this file.

## Unreleased

### Added

- Agent rule: maintain `CHANGELOG.md` and update it in the same commit as any repository change.

### Changed

- Ralph now stores incidental orchestrator artifacts under `.agent-cortex/ralph/` (logs, progress snapshots, and state) instead of the repository root.
- Ralph, run-beads, and stage prompt templates now consistently point progress logging to `.agent-cortex/ralph/ralph-<bead-id>.log`.
- Git ignore guidance now standardizes on ignoring `.agent-cortex/` so incidental runtime files stay out of source control.
