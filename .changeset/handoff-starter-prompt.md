---
"@jaybeeuu/agent-cortex": minor
---

Handoff documents now end with a `## Starter prompt` section: a ready-to-paste first-message prompt pointing the next session at the handoff doc by absolute path and the artifacts it references, telling it to read those before acting, asking it to clean up any provisional artifacts unless the handoff says otherwise, and staying under ~150 words.