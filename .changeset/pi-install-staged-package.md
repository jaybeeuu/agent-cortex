---
"@jaybeeuu/agent-cortex": minor
---

`agent-cortex install pi` now stages a self-contained pi package at
`~/.agent-cortex/pi` (manifest, agents, skills, extensions, and the bundled
pi-questions / pi-web-access trees) instead of writing into pi's own
`~/.pi/agent` directories. Register the staged package with `pi install
~/.agent-cortex/pi`. `--no-provision` is gone — the required packages travel
inside the staged tree — and the installer no longer materialises pi's
`settings.json` / `keybindings.json`.
