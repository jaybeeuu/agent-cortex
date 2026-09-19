---
"@jaybeeuu/agent-cortex": patch
---

Extract the generic async `isFile`/`isDirectory` stat wrappers into a shared `scripts/lib/fs.mjs` and import them from the claude, copilot, and pi installers instead of redefining them inline.
