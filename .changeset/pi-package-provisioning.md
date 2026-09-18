---
"@jaybeeuu/agent-cortex": patch
---

Provision the pi packages agent-cortex needs (pi-questions for `ask_questions`, pi-web-access for `fetch_content`) on `agent-cortex install pi`. The package manifest now declares them under `pi.packages`, the installer installs any that the pi user scope is missing via the pi CLI (idempotent, warns and continues on failure), and `--no-provision` opts an offline machine out. The token-map `ask_user` / `web_fetch` mappings are no longer no-ops on a clean `~/.pi`.
