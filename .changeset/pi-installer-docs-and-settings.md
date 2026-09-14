---
"@jaybeeuu/agent-cortex": patch
---

Document why the pi installer's substituted skills are the sole pi skill source (the local pi/settings.json packages filter `{ source, "skills": [] }` keeps raw package skills out) and update pi/settings.json to the current runtime config (models, packages, compaction, TUI prefs).