# Idea: Extension manifest diff

## Status
Backlog idea (not implementation-ready)

## Created
2026-09-22

## Problem
The declared extension set and the machine's actual state drift silently. Whichever declaration
wins — `package.json` → `pi.packages` on `main`, or the per-harness `pi.extensions.json` /
`claude.extensions.json` from the unmerged pi-harness epic — nothing compares it against what
each harness has installed. A declared extension can be missing locally (fresh machine, failed
install, manual `pi remove`), and the only way to notice is to read two different stores by
hand. `agent-cortex ext install` is idempotent but has no notion of "what is missing" — it
re-runs the whole declared set.

## Who benefits
The author. One command answers "does this machine match my declared toolset, and what is
missing?" instead of eyeballing `pi list` / `claude plugin list --json` against a JSON file. It
turns restoring a machine, or debugging a missing extension, into a single step.

## Proposed outcome
A CLI command (working name `agent-cortex ext diff`) that reads the declared extension set for a
harness and the harness's local store, and reports the difference: **declared but missing** and
**installed but undeclared**. Missing entries can be installed interactively, one confirmation
per entry; an `--all` flag installs every missing entry without prompting. Undeclared extras are
reported only — uninstalling them stays with the harness's own CLI (`pi remove`,
`claude plugin uninstall`), consistent with rejecting the `ext prune` wrapper. Covers pi, claude,
and copilot. Reuses the manifest reader and the harness's own listing (`pi list` / settings
`packages`; `claude plugin list --json`).

## Validity check
- Evidence we already have: the `extension-manifests` idea names non-reproducibility as the core
  problem; both `agent-cortex ext install` (F5, `agnt-ctx-v41b`) and `lib/pi-packages.mjs`
  (PR #135) provision a declared set; both harnesses expose a listing API — `pi list` (verified
  on pi 0.85.1) and `claude plugin list --json`.
- Riskiest assumption: that "declared" and "installed" entries can be matched reliably. pi stores
  sources as `npm:foo@1.2.3` or paths while declarations may be unpinned or aliased; claude
  identifies plugins by `plugin@marketplace` id. If normalisation is fuzzy, the diff is noisy and
  untrustworthy.
- What would invalidate this idea: if declared→installed matching cannot be made reliable without
  a shared normalisation layer, or if drift turns out to be rare enough that idempotent
  `ext install` plus `pi list` is sufficient in practice.

## Constraints
- The CLI never writes the committed declaration — changing the declared set stays an edit +
  commit (same rule as F5/F6).
- Zero LLM calls; no runtime dependencies (numbered readline, matching the installer style).
- Install must be idempotent and degrade gracefully: a failed entry warns and the rest continue.
- copilot has no declaration yet (blocked on the copilot-harness epic `agnt-ctx-z4i1`), so that
  harness is a later addition.
- The authoritative declaration is currently unsettled: `main` uses `package.json` →
  `pi.packages`; the unmerged pi-harness epic (`agnt-ctx-dfq3`) introduces `pi.extensions.json` /
  `claude.extensions.json`. Resolve which wins before building.

## Next validation step
Prototype the comparison for the pi harness only: normalise the `packages` array in
`~/.pi/agent/settings.json` against the declared set and print declared-but-missing /
installed-but-undeclared. That is the cheapest test of the riskiest assumption.

## Notes
Recorded 2026-09-22 after closing PR #142 (F6 `ext prune`) as redundant with the harnesses' own
package management. This idea is the non-redundant remainder of
[`extension-manifests.md`](extension-manifests.md): the harnesses own install/remove/list, so the
useful thing to build is the reconciliation, not another uninstall UI. Priority P2. Blocked
conceptually on deciding the authoritative declaration (`main`'s `pi.packages` vs the epic's
per-harness manifests).
