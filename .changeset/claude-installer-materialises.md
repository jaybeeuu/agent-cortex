---
"@jaybeeuu/agent-cortex": minor
---

`agent-cortex install claude` now materialises the plugin: home-scoped install into `~/.agent-cortex/claude`, copied (token-substituted, no symlinks) skills, marketplace manifest, and automatic registration with Claude Code. Installer toolchain is fully async (no `*Sync` — never block the main thread), enforced by a `check-no-sync` lint scanner.