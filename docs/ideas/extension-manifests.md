# Idea: extension-manifests

## Status
Backlog idea (not implementation-ready)

## Created
2026-08-25

## Problem
PI extensions and Claude/Copilot plugins are installed individually (`pi install <ext>`) and
live implicit in the machine's state (`~/.pi/agent/extensions/`) with no declared manifest of
what the author uses or where it came from. A fresh machine, clean `~/.pi`, or a failed update
leaves the environment without the expected extensions. The toolset isn't reproducible and
isn't documented anywhere in the author's repos. Experimenting with an extension (install, try,
remove) is also all manual, and there's no way to uninstall cleanly.

## Who benefits
The author. Installing/updating agent-cortex becomes a reliable way to restore a known PI +
Claude environment (agent-cortex + declared extensions in one step). The manifests document and
reproduce the toolset across machines. A prune CLI makes extension experimentation fast and safe.

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

agent-cortex's own bundled extensions (auto-discovered via `pi install`, e.g. `skill-stats`)
are deliberately excluded from the manifests — only third-party extensions are declared.

## Validity check
- Evidence we already have: agent-cortex already has an install surface to hang this on
  (`pi install` package discovery for the pi harness, plus the existing `bin/agent-cortex.mjs`
  install command and `postinstall` script). The repo already carries a `plugin.json` (Claude
  harness) alongside `package.json` (pi harness), showing the per-harness split is natural.
- Riskiest assumption: that an automated install-on-update of declared extensions is safe and
  desirable (auto-installing on every update could surprise, or fail mid-flight on a new
  machine lacking auth/network). Also, the TUI prune needs the local extension store's shape
  (`~/.pi/agent/extensions/` for pi; whatever Claude uses) to be introspectable.
- What would invalidate this idea: if auto-install-on-update proves too disruptive (better as
  an explicit `agent-cortex ext install` command), or if the pi/Claude installers don't expose
  the store in a way that supports listing + uninstall for the TUI.

## Constraints
- Manifests live in this repo, committed via the normal PR flow — the CLI never edits them.
- Install-on-update must be idempotent and safe to skip/fail gracefully (no hard breakage of
  agent-cortex's own install on extension failure).
- Follow the repo's extension conventions where relevant (lightweight, no internal LLM calls).
- If any local data is persisted (e.g. prune history), write to `~/.pi/agent-cortex/`.

## Next validation step
Confirm the install surface for each harness: how `pi install <source>` works for the pi side,
and how Claude/Copilot plugins get installed, plus whether each store can be listed and
uninstalled programmatically (needed for the prune TUI). Then prototype the manifest + one
harness's install-on-update path.

## Notes
Recorded 2026-08-25. The idea was refined during the interview: initially framed as
"record the extensions I use" (observer-based), corrected to a **committed manifest** model —
recording happens by editing + committing, not by monitoring. Prune uninstalls locally only;
the manifest stays GitHub-managed. This idea is adjacent to `record-ideas-as-beads`: both make
agent-cortex the declared source of truth for the author's environment and workflow.