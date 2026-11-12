---
"@jaybeeuu/agent-cortex": patch
---

Stop `agent-cortex install claude` erasing Claude Code's `enabledPlugins` entry.

The settings merge now asserts only the `enabledPlugins` and `extraKnownMarketplaces` entries the
committed `claude/settings.json` template declares; entries it does not declare survive, so a
same-version re-run keeps the entry Claude Code writes when the plugin is enabled. Registration
also reports an installed-but-not-enabled plugin, naming `claude plugin enable <plugin>@<marketplace>`.
