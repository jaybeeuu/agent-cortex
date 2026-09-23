# Idea: ctx alias, version and update commands

## Status
Backlog idea (not implementation-ready)

## Created
2026-09-02

## Problem
`agent-cortex` is a long name to type, and there is no way to see what is actually
installed across the harnesses (pi / claude / copilot) or to bring an installed
runtime up to date. The user currently inspects state manually or re-runs
`agent-cortex install <harness>` after a release with no idea what changed.

## Who benefits
The author, in every coding session: a shorter command to reach the CLI, and two
commands that answer "what's installed and is it current?" without remembering the
install-manager internals. Anyone else using the plugin (published via npm) gets
the same surface.

## Proposed outcome
- `ctx` as a shell alias for `agent-cortex`, installed by the CLI itself (appends to
  the user's shell rc during setup/install).
- `ctx version` reporting installed state per harness (pi / claude / copilot): which
  artifacts are installed, their versions, and whether they match the CLI's release.
- `ctx update` re-running the install for each harness whose installed state is stale.
- Nothing here changes what installation does — the commands read and reuse the
  install manager, not a parallel mechanism.

## Validity check
- Evidence we already have: the install epics (pi harness `agnt-ctx-dfq3` first, then
  claude, then copilot) are already making the install manager authoritative per
  harness; the F9 integration smoke (`agnt-ctx-t7xu`) will verify installed state
  end-to-end and is the natural substrate for `version`.
- Riskiest assumption: the install epics leave behind a stable, queryable notion of
  "what is installed" (a fingerprint: version + presence per harness) that `version`
  can read and `update` can compare against. If installed state stays implicit
  (symlinks, unversioned copies), `version`/`update` have nothing reliable to report and
  the idea deflates into a thin alias.
- What would invalidate this idea: the harness epics ship without any record of
  per-harness installed version, or `update` turns out to be indistinguishable from
  a plain `install` (i.e. no stale/current distinction ever exists).

## Constraints
- Must reuse the install manager (one code path for install, version, update) — no
  second mechanism that could drift.
- Alias must be opt-in or clearly announced at install; overwriting an existing
  `ctx` command in the user's shell is unacceptable (collision check first).
- No version coupling invented per harness — installed version means the agent-cortex
  release the harness artifact was materialised from.

## Next validation step
When the pi install epic (F3–F6) lands, check whether the installed artifacts carry a
version fingerprint (file header comment or manifest). If yes, `ctx version` has its
data source and the idea is implementation-ready; if not, the smoke-test epic
(`agnt-ctx-543s`) must be asked to define one, which is also where `ctx update` gets
its stale-detection.

## Notes
- Recorded from a session while the pi harness install manager epic was in flight;
  priority felt like P3 — after the install epics merge, not folded into them.
- `ctx` is a common shell name (context tools, context-mode). The alias install must
  check for an existing command and surface the clash rather than silently override.
- Idea belongs to the same surface as the install-manager epics: version/update are
  the read/refresh side of the same CLI.