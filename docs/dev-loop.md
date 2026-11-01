# The dev loop

Two trees, two jobs. `~/src/agent-cortex` is what you **develop**. `~/.agent-cortex` is what you
**run**. This page records how to refresh the second from a release, and how to try the first
without touching it.

## Refresh the installed runtime

```sh
pnpm add -g @jaybeeuu/agent-cortex@latest
agent-cortex install pi
agent-cortex install claude
```

- `agent-cortex install <harness>` is idempotent and safe to re-run. A re-run at the same version
  changes nothing; a newer version re-stages and updates what registration state says is stale.
- `--dry-run` prints the full plan and writes and spawns nothing: `agent-cortex install pi
  --dry-run`.
- **Both harnesses need a restart.** pi reads its package sources at startup and holds the loaded
  extension and skill modules for the session; Claude Code resolves plugins at startup too. A
  running session keeps the old version until you restart it.

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

Stage the checkout into a scratch package and load that package for one session:

```sh
# 1. Stage the checkout. Nothing is registered, nothing is swept, ~/.agent-cortex is untouched.
node ~/src/agent-cortex/bin/agent-cortex.mjs install pi --output /tmp/agent-cortex-dev

# 2. Start pi against the staged copy, for this session only.
pi -ne -e /tmp/agent-cortex-dev
```

Re-stage, then restart, after each edit — the session keeps the copy it loaded:

```sh
node ~/src/agent-cortex/bin/agent-cortex.mjs install pi --output /tmp/agent-cortex-dev \
  && pi -ne -e /tmp/agent-cortex-dev
```

`-ne` is required. Without it pi also loads the installed `~/.agent-cortex/pi`, and that copy's
extensions fail to load against the staged ones (`Failed to load extension
"/home/jaybeeuu/.agent-cortex/pi/extensions/subagent/index.ts": Tool "subagent" conflicts with
/tmp/agent-cortex-dev/extensions/subagent/index.ts`). With `-ne`, only the staged copy loads, and
its skills shadow the installed ones of the same name for that session. The cost: `-ne` also
drops the extensions of every other installed package (context-mode's tools, vision, hypa) and
the built-in MCP support. The staged package's own bundled tools — `ask_questions`,
`web_search`, `fetch_content` — still load; pass another `-e <path>` for anything else you need.

**Getting back is doing nothing.** `-e` lasts one invocation and writes no settings, so exit the
session and run plain `pi` — the installed `~/.agent-cortex/pi` loads again. There is no undo.

### Running pi inside the checkout does not do this

`cd ~/src/agent-cortex && pi` loads the **installed** runtime, not the checkout. pi reads project
resources from `.pi/{extensions,skills,prompts,themes}` and `.pi/settings.json`; this repo has
neither, and pi never reads a project's own `package.json` `pi` field. Verified: run there and
all 34 agent-cortex skills resolve from `~/.agent-cortex/pi/skills`. The one exception is the
repo's `.agents/skills/`, which pi discovers by walking up from the working directory.

## Try uncommitted work (Claude Code)

Same shape: `agent-cortex install claude --output /tmp/agent-cortex-claude`, then
`claude --plugin-dir /tmp/agent-cortex-claude`. `--output` generates only, with no marketplace
manifest, no registration, and no write to `~/.claude`. `SKILL.md` edits are live in that
session; `/reload-plugins` picks up agent, hook, and MCP changes. Quitting the session restores
the installed plugin. README's "Try it for one session" has the same commands.

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
