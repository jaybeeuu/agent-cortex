# Idea: extension-manifests

## Status
Partially implemented — the pi-harness slice shipped (see "What shipped"); the
Claude/Copilot manifest remains backlog. The prune TUI was built and then **rejected** (see
"Prune rejected") — the harnesses already own extension package management. The useful
remainder, a declared-vs-installed diff, is recorded separately in
[`extension-manifest-diff.md`](extension-manifest-diff.md).

## Created
2026-08-25

## Problem
PI extensions and Claude/Copilot plugins are installed individually (`pi install <ext>`) and
live implicit in the machine's state (`~/.pi/agent/extensions/`) with no declared manifest of
what the author uses or where it came from. A fresh machine, clean `~/.pi`, or a failed update
leaves the environment without the expected extensions. The toolset isn't reproducible and
isn't documented anywhere in the author's repos. Experimenting with an extension (install, try,
remove) is also all manual, and there is no view of how the machine differs from the declared set.

## Who benefits
The author. Installing/updating agent-cortex becomes a reliable way to restore a known PI +
Claude environment (agent-cortex + declared extensions in one step). The manifests document and
reproduce the toolset across machines. A declared-vs-installed diff makes drift visible and
repairable.

## Proposed outcome
agent-cortex ships **committed extension manifests** (reviewed and stored on GitHub) declaring
which extensions to install — **per harness**: one manifest for PI extensions, one for
Claude/Copilot plugins. On install or update of agent-cortex, it reads the manifests and
installs the declared extensions. The manifests are the single source of truth.

Key decisions from the interview:

1. **No monitoring** — nothing observes installs, and the CLI never writes the manifests.
   Adding an extension = edit the manifest, commit it, ship it. This keeps the source of truth
   in GitHub where it belongs (and gets the usual PR/review flow).
2. **Per-harness manifests** — separate records for the pi harness vs the Claude harness, each
   carrying the extension source (git URL / package name) for that harness's installer. The
   install-on-update path handles each harness with its own mechanism.
3. **Prune CLI with a TUI** — a CLI command (e.g. `agent-cortex ext prune`) opens an interactive
   TUI listing locally-installed extensions; selecting one **uninstalls** it from the local
   environment. Removing from the manifest is done manually on GitHub. This supports the
   experimentation loop: install → try → prune locally, then curate the manifest separately.
   **Reversed 2026-09-21** — the harnesses already provide uninstall; see "Prune rejected".

agent-cortex's own bundled extensions (auto-discovered via `pi install`, e.g. `skill-stats`)
are deliberately excluded from the manifests — only third-party extensions are declared.

## What shipped (2026-09-18)

The pi half of the problem is solved without a new manifest file: the packages agent-cortex
needs are declared in the **existing** package manifest at `package.json` → `pi.packages`, and
`agent-cortex install pi` provisions them through the `pi` CLI into the pi user scope
(`lib/pi-packages.mjs`). Reusing the shipped manifest beat introducing a parallel per-harness
manifest file, which would have duplicated a declaration agent-cortex already publishes.

Three properties are deliberate and should survive future changes: provisioning is
**idempotent** (a package both declared in `~/.pi/agent/settings.json` and present in the pi npm
store is skipped), **degrades gracefully** (a missing `pi` CLI or a failed install warns and the
agent install still succeeds), and is **opt-out** via `--no-provision` — automatically off for the
`--output` generate-only form, and never run on `--dry-run`.

Still unbuilt: the Claude/Copilot manifest. `pi/settings.json` also lists these
packages for the symlinked-checkout workflow (where pi auto-installs them); that redundancy is
intentional until the manifest model is extended to both harnesses.

## Prune rejected (2026-09-21)

The prune half was implemented (F6, `agnt-ctx-17hc`) and then rejected: PR #142 was closed
unmerged and its branch deleted. The harnesses already own extension package management —
`pi install/remove/list` and `claude plugin install/uninstall/list --json` — so an interactive
wrapper around uninstall added no capability. The implementation's recorded justification that
"pi does not have a listing API" is **wrong**: `pi list` exists (verified on pi 0.85.1) and lists
installed packages from user and project settings, so the hand-rolled settings reader duplicated
it. What is genuinely missing is not an uninstall UI but a **diff** between the declared set and
the installed set, recorded in [`extension-manifest-diff.md`](extension-manifest-diff.md).

## Validity check
- Evidence we already have: agent-cortex already has an install surface to hang this on
  (`pi install` package discovery for the pi harness, plus the existing `bin/agent-cortex.mjs`
  install command and `postinstall` script). The repo already carries a `plugin.json` (Claude
  harness) alongside `package.json` (pi harness), showing the per-harness split is natural.
- Riskiest assumption: that an automated install-on-update of declared extensions is safe and
  desirable (auto-installing on every update could surprise, or fail mid-flight on a new
  machine lacking auth/network). The store-shape question that gated the (now rejected) prune
  TUI is resolved: both harnesses expose a listing API (`pi list`; `claude plugin list --json`).
- What would invalidate this idea: if auto-install-on-update proves too disruptive (better as
  an explicit `agent-cortex ext install` command). The prune half is already invalidated — see
  "Prune rejected".

## Constraints
- Manifests live in this repo, committed via the normal PR flow — the CLI never edits them.
- Install-on-update must be idempotent and safe to skip/fail gracefully (no hard breakage of
  agent-cortex's own install on extension failure).
- Follow the repo's extension conventions where relevant (lightweight, no internal LLM calls).
- If any local data is persisted (e.g. prune history), write to `~/.pi/agent-cortex/`.

## Next validation step
The store question is answered: both harnesses expose a listing API (`pi list`; `claude plugin
list --json`), so listing needs no hand-rolled reader. The open question is reliable matching of
declared sources to installed entries across harnesses — see
[`extension-manifest-diff.md`](extension-manifest-diff.md), whose first prototype tests exactly
that.

## Notes
Recorded 2026-08-25. The idea was refined during the interview: initially framed as
"record the extensions I use" (observer-based), corrected to a **committed manifest** model —
recording happens by editing + committing, not by monitoring. The manifest stays GitHub-managed
(the CLI never writes it); the prune CLI was rejected, so local uninstall stays with the
harnesses' own commands. This idea is adjacent to `record-ideas-as-beads`: both make
agent-cortex the declared source of truth for the author's environment and workflow.