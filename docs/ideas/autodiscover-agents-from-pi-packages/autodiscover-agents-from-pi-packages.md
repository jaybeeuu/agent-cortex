# Idea: Autodiscover agents from PI packages

## Status
Backlog idea (not implementation-ready)

## Created
2026-06-01

## Problem
The subagent extension currently discovers agents from hardcoded paths (`~/.pi/agent/agents/`, `.pi/agents/`, and optionally its own bundled `agents/` dir). If third-party PI packages want to bundle agent definitions for the subagent tool, there's no convention for them to do so — users would need to manually symlink or copy agent files. This limits the shareability of agent definitions the same way `extensions/`, `skills/`, `prompts/`, and `themes/` are auto-discovered from packages.

## Who benefits
- Anyone publishing a PI package that includes reusable agent definitions
- Anyone consuming PI packages who wants those agents available without manual setup
- The agent-cortex repo itself, if it ever publishes agents as a standalone package

## Proposed outcome
The subagent extension's `discoverAgents()` scans all installed PI packages (from `~/.pi/agent/npm/`, `~/.pi/agent/git/`, and local paths in settings) for an `agents/` directory or an `"agents"` key in the package's `pi` manifest. Agents found in packages are merged with user-level and project-level agents with standard override semantics.

## Validity check
- Evidence we already have: PI already auto-discovers `extensions/`, `skills/`, `prompts/`, and `themes/` from packages — the infrastructure for scanning packages exists in PI core. The subagent extension already has a `discoverAgents()` function we can extend.
- Riskiest assumption: That the package-scanning overhead (reading settings, walking directories on every subagent invocation) is acceptable and doesn't noticeably slow down subagent startup.
- What would invalidate this idea: PI core adds native agent path contribution to the `resources_discover` event — making the extension-level work unnecessary. Or, no real demand emerges for packaged agent bundles.

## Constraints
- Must not slow down the common case (single user/project agent dir) — package scanning should be lazy, cached, or opted in.
- The extension must handle the case where a package has no `agents/` dir gracefully (no error, just skip).
- Override semantics must be well-defined: package agents < user agents < project agents (narrower scope wins).

## Next validation step
Wait until either:
1. Someone publishes a PI package that would benefit from bundling agents, or
2. The current subagent extension's agent discovery proves too rigid for the ralph workflow and we're already modifying `discoverAgents()`.

## Notes
Discussed 2026-06-01 during ralph PI skill planning session. Decided to go with simpler approach for now (extension discovers agents from its own `agents/` dir via relative path), and park this as an idea for future consideration. The immediate priority is getting the ralph subagent pipeline working with the PI package structure.
