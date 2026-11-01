---
"@jaybeeuu/agent-cortex": patch
---

Make the generated Claude plugin manifest valid: `repository` is always emitted as a string, normalising npm's object form to its `url` (falling back to `directory`, and omitted when neither exists) instead of copying the object through. An object there made Claude Code reject the whole plugin, hiding every skill and agent. The installer now also re-reads `claude plugin list --json` after registering and fails with Claude's validation error when the plugin reports failed to load, instead of reporting success. When that list cannot be read, or does not list the plugin, the installer warns that the load state is unconfirmed and omits its success message.
