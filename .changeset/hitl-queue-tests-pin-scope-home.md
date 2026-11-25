---
"@jaybeeuu/agent-cortex": patch
---

Pin `AGENT_CORTEX_HOME` to the temp root in the `recommend` and `shortlist` test files. Both read
the scope list, which falls back to the user-level `~/.agent-cortex/scopes.json`, so a machine that
had registered a personal scope read every fixture workspace twice and failed the suite. The
`hitl-queue` and `hitl-queue-scopes` suites already pin it; these two did not.
