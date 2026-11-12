---
"@jaybeeuu/agent-cortex": minor
---

New `cortex` and `ctx` commands: both run the same CLI as `agent-cortex`. The help text and the error hints now name the command that was invoked, so `ctx --help` prints `Usage: ctx <command>`; any other script name falls back to `agent-cortex`.
