---
"@jaybeeuu/agent-cortex": minor
---

Map `ask_user` → `ask_questions` (pi-questions package) and `skill` → `read` in the pi column of token-map.json: pi agent modes regain interactive questioning (`ask_questions`) instead of dropping the tool with a startup warning, and skill references resolve to reading their SKILL.md. Notes and docs updated to record that `ask_questions` is provided by the pi-questions package.