# The dev loop

Two trees, two jobs. `~/src/agent-cortex` (or a ralph worktree of it) is what you **develop**.
`~/.agent-cortex` is what you **run**. This page records how to refresh the second from a
release, and how to try the first without touching it.

## Refresh the installed runtime

```sh
pnpm add -g @jaybeeuu/agent-cortex@latest
agent-cortex install pi
agent-cortex install claude
```

The first line is not optional, and it also repairs a stale global CLI: on this machine the 2.3.0
shim pointed at a deleted pnpm store path, so every `agent-cortex` call failed with
`MODULE_NOT_FOUND` until the reinstall. The published tarball ships `bin/` and `scripts/`, so
`pnpm add -g` restores the command.

- `agent-cortex install <harness>` is idempotent and safe to re-run. A re-run at the same version
  rewrites the staged files identically and makes no registration change; a newer version
  re-stages the package and updates the registration.
- `--dry-run` prints the full plan and writes and spawns nothing: `agent-cortex install pi
  --dry-run`.
- **pi needs a restart.** pi reads its package sources at startup and holds the loaded extension
  and skill modules for the session, so a running session keeps the old version.
- **Claude Code can reload instead.** `/reload-plugins` applies the installed update to a running
  session; a new session also picks it up.

Verify registration, not files: `pi list` shows `../../.agent-cortex/pi` as its one agent-cortex
source, and `claude plugin list` shows `agent-cortex@jaybeeuu`, read from
`~/.agent-cortex/claude`.

## What the installer writes

| Path | What it is |
|---|---|
| `~/.agent-cortex/pi` | Staged pi package — manifest, flat rendered agents, token-substituted skills, a copy of `extensions/`, `token-map.json`, bundled `node_modules`. This is the source `pi list` registers. |
| `~/.agent-cortex/claude` | The materialised Claude plugin — agents, flat skills, `hooks.json`, `.mcp.json`, `scripts/`. |
| `~/.agent-cortex/.claude-plugin/marketplace.json` | Marketplace manifest exposing `./claude`. |
| `~/.agent-cortex/legacy-sweep.json` | The one-shot record of the legacy `~/.pi/agent` sweep, so it never runs twice. |

`~/.pi/agent/skills` and `~/.pi/agent/agents` stay **empty**. They are pi's user directories, so
anything written there is a second source of a skill that already ships in `~/.agent-cortex/pi`.
pi's own `~/.pi/agent/settings.json` belongs to pi: the installer reads it to decide the plan and
lets the `pi` CLI write it.

## Try uncommitted work (pi)

Stage the checkout into a scratch package and load that package for one session. Run the commands
from the tree you are editing — `~/src/agent-cortex`, or a ralph worktree, whose content is what
gets staged:

```sh
# 1. Stage the checkout. Nothing is registered, nothing is swept, ~/.agent-cortex is untouched.
node bin/agent-cortex.mjs install pi --output /tmp/agent-cortex-dev

# 2. Start pi against the staged copy, for this session only.
pi -ne -e /tmp/agent-cortex-dev
```

Re-stage, then restart, after each edit — the session keeps the copy it loaded:

```sh
node bin/agent-cortex.mjs install pi --output /tmp/agent-cortex-dev \
  && pi -ne -e /tmp/agent-cortex-dev
```

`-ne` is required. Without it pi also loads the installed `~/.agent-cortex/pi`, the two copies
collide on ten extension registrations, and pi exits 1 before the session starts. The first line
is:

    Failed to load extension "/home/jaybeeuu/.agent-cortex/pi/extensions/subagent/index.ts": Tool "subagent" conflicts with /tmp/agent-cortex-dev/extensions/subagent/index.ts

The conflicts cover the `--agent` flag, the `subagent`/`task`/`wait_for_agents`/`read_agent`
tools, `ask_questions`, and the four `web_search`/`code_search`/`fetch_content`/
`get_search_content` tools. With `-ne`, only the staged package's extensions load. Skill
discovery is separate and still runs: the installed packages' skills remain (context-mode's
`ctx-*` skills still appear), and the staged skills shadow the installed ones of the same name.
The cost: `-ne` drops the extensions of every other installed package (context-mode's tools,
vision, hypa) and the built-in MCP support. The staged package's own bundled tools —
`ask_questions`, `web_search`, `fetch_content` — still load; pass another `-e <path>` for
anything else you need.

**Getting back is doing nothing.** `-e` lasts one invocation and writes no settings, so exit the
session and run plain `pi` — the installed `~/.agent-cortex/pi` loads again. There is no undo.

### Running pi inside the checkout does not do this

`cd ~/src/agent-cortex && pi` loads the **installed** runtime, not the checkout. pi reads project
resources from `.pi/{extensions,skills,prompts,themes}` and `.pi/settings.json`; this repo has
neither, and pi never reads a project's own `package.json` `pi` field. Verified: run there and the
agent-cortex skills resolve from `~/.agent-cortex/pi/skills` — 32 in the model-facing list;
`migration` and `teach` sit on disk but set `disable-model-invocation`, so pi omits them.
`librarian` comes from the bundled `pi-web-access` package in `node_modules`. The one exception
is the repo's `.agents/skills/`, which pi discovers by walking up from the working directory.

## Try uncommitted work (Claude Code)

Same shape: `agent-cortex install claude --output /tmp/agent-cortex-claude`, then
`claude --plugin-dir /tmp/agent-cortex-claude`. `--output` generates only, with no marketplace
manifest, no registration, and no write to `~/.claude`. The output is a copy, not a symlink, so
re-run the generator after editing the checkout; edits to the generated `SKILL.md` are live in
the session, and `/reload-plugins` picks up generated agent, hook, and MCP changes. Quitting the
session restores the installed plugin. README's "Try it for one session" has the same commands.

## The boundary

The checkout is what is developed. `~/.agent-cortex` is what is run. Registration stores a
**path**, so registering anything under `~/src` makes the runtime depend on a directory that
exists only while a branch is checked out:

- **Never** add a path inside `~/src` as a pi package source or a Claude marketplace target.
- **Never** symlink an install consumer into a temporary directory (`/tmp` is a tmpfs).

Both have broken this machine:

1. `~/.pi/agent/settings.json` carried `packages[0].source` =
   `../../src/agent-cortex/.agent-cortex/worktrees/agnt-ctx-s5xd.1.5` — a dev worktree of a closed
   epic, pruned on 2026-10-28. pi then loaded no agent-cortex resources at all; what ran were
   stale copies written into `~/.pi/agent/skills`.
2. `~/.claude/plugins/repos/jaybeeuu/agent-cortex` was a symlink to `/tmp/agent-cortex-market`.
   The reboot after it was created removed the target.

Use `agent-cortex install <harness>` for the runtime and a scratch `--output` directory for
development. A pruned worktree then breaks only a scratch path you were about to delete anyway.
