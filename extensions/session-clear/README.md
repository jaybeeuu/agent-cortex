# Session Clear Extension

Adds `/clear` to PI: keep the session identity, drop the transcript context.

PI has `/new`, `/compact`, `/fork`, and `/clone`, but none of them is "same
session identity, empty context". `/new` starts a fresh session and the
replacement falls back to the default display name, model, and thinking level, so
clearing the context costs three follow-up commands (`/name`, `/model`, the
thinking level). `/clear` carries the identity across in one command.

## Usage

| Command | Description |
| --- | --- |
| `/clear` | Replace the session with an empty one, keeping its identity |

What it keeps: the session display name, the model, the thinking level, and the
active agent. What it drops: every message, tool call, and file content.

It never asks for confirmation, never summarises, never carries a handoff
message, and never deletes the cleared session file. The cleared session stays
resumable through `/resume` and appears as the parent in `/tree`.

## What happens

1. `/clear` captures the identity as plain data: display name, model, thinking
   level, and the current session file.
2. It replaces the session with `ctx.newSession({ parentSession })`, so the old
   session file is recorded as the parent.
3. The replacement instance re-applies the name, and restores the model and the
   thinking level only when they differ from the replacement's own values — a
   default is never needlessly re-pinned.
4. It appends a `session-clear` provenance entry naming the cleared session, and
   reports the clear in one line.

All of this happens without a model call: the extension never prompts the model.

## Why the identity is re-applied by the replacement instance

`newSession()` tears the old session down before it rebinds the replacement, so
the `pi` and command `ctx` captured by the command handler are stale by the time
the replacement exists, and `withSession`'s context exposes no way to set the
name, model, or thinking level. The replacement extension instance is the only
live handle, so the captured identity crosses to it in one process-global slot
and it is applied at that instance's own `session_start`. PI re-evaluates
extension modules for the replacement runtime, so a module-level variable would
not survive the crossing.

The active agent needs no handling: the replacement runtime is built from the
same launch configuration, so an agent selected with `--agent <name>` re-applies
its own system prompt and tool set at `session_start`, exactly as it does at
startup. (An agent switched mid-session with `/agent` is session state, not
launch state: it does not cross into the replacement.)

## Claude Code parity

This extension is PI-only. Claude Code already ships `/clear`, so there is no
hook port and no hook equivalent to keep in step. The audit in
`docs/claude-hooks.md` therefore records no entry for this capability.

## Development

```bash
pnpm test        # behaviour: capture, replace, re-apply, provenance, no prompts
pnpm typecheck   # tsc --noEmit, which also checks the complete ExtensionAPI double
```

`index.test.ts` drives the command through a fake `ExtensionAPI` whose action
methods throw once the session is replaced — the same failure a stale `pi` gives
at runtime — plus a fake command context that performs the replacement, loads a
fresh extension instance, and starts the new session before returning.
