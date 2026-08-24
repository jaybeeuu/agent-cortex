---
"@jaybeeuu/agent-cortex": patch
---

Complete the move to install-time Claude code generation: the standalone `scripts/build-claude-agents.mjs` build script is removed and `pnpm build:claude` is now a pure alias of `agent-cortex install claude` — both invoke the shared `bin/installers/claude.mjs` generator, so there is a single code path for the committed `claude/` plugin subtree and install-time vs regenerated output can never diverge. Generated agents carry installer provenance headers, and CI's drift check (regenerate + `git diff --exit-code`) validates the committed subtree byte-for-byte against installer output. `agents-native/` remains the canonical source for Claude-native agents (`ralph`), copied verbatim by the installer.