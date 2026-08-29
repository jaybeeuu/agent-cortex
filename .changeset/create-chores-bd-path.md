---
"@jaybeeuu/agent-cortex": patch
---

Fix create-chores to resolve `bd` via PATH by default instead of a machine-specific hardcoded path. The BD_PATH env override is retained for machines where bd is not on PATH.