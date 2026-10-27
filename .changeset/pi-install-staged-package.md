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

The committed `pi/settings.json` template drops its `npm:pi-questions` and
`npm:pi-web-access@0.10.7` entries for the same reason: once the staged package
carries those tools, the `packages` array holds only the optional personal
toolset (`@getpipher/vision`, `@hypabolic/pi-hypa`, `context-mode`), so there is
one source of truth for `ask_questions` / `fetch_content` instead of two that can
drift. Its `../../src/agent-cortex` entry goes too, so the staged package is the
only agent-cortex source pi loads.

The `subagent` extension discovers agents from the package it ships inside as
well as from pi's own user agent dir, so a staged package supplies the agents it
ships instead of depending on `~/.pi/agent` copies. A source checkout's
composable `agents/` tree is left to `agent-modes`, which composes it at runtime;
the flat renders committed there are for other harnesses and are not read as pi
agents. Frontmatter `tools` written as a YAML sequence is accepted alongside the
scalar form.
