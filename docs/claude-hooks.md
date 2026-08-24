# Claude Code hooks — extension port audit

The pi extensions in `extensions/` were audited for Claude Code equivalents.
Implemented ports live in `hooks/claude/hooks.json` (copied verbatim into the
generated plugin as `claude/hooks.json`); support scripts live in
`hooks/claude/scripts/` and are bundled into `claude/hooks/scripts/` by
`bin/installers/claude.mjs` (referenced from hooks.json via `$CLAUDE_PLUGIN_ROOT`).

Claude Code's hook model differs from PI's: hooks are shell commands fed a JSON
payload on stdin, with events like `SessionStart`, `SessionEnd`, `Stop`,
`SubagentStop`, and `Notification` — there is no `before_agent_start` /
`agent_end` / `tool_call` extension API, no runtime tool registration, and no
UI surface. Each decision below is grounded in the Claude Code hooks reference.

| pi extension | Claude port | Decision |
|---|---|---|
| `session-start.ts` | `SessionStart` hook commands | **Port** (extended) |
| `auto-name.ts` | — | **Reject** — built-in |
| `notify/` | `Notification` hook + `scripts/notify.mjs` | **Port** |
| `skill-stats/` | — | **Reject** — no equivalent |
| `subagent/` | — | **Reject** — native |
| `agent-modes/` | — | **Reject** — no equivalent |

## `session-start.ts` → SessionStart (port)

pi injects skill-availability hints + project context files (AGENTS.md,
`docs/user-preferences.md`) into every session. Claude Code already loads
`AGENTS.md` natively and the existing SessionStart hook nudge ("Load AGENTS.md
and active beads context…") plus the style-skill policy (PR #57) cover the
context side. This bead closes the remaining gap: a skill-policy command listing
the meta-skills (`using-agent-skills` for routing, `bd-tool` for beads context,
`git-workflow` for branch/PR discipline). SessionStart command-hook stdout is
added to Claude's context, so plain `echo` commands are the right shape —
keep them fast and dependency-free. Skipped from the pi original: the dynamic
file read of AGENTS.md/user-preferences.md, since Claude Code loads AGENTS.md
itself and user-preferences.md is a pi-harness document.

## `auto-name.ts` → Reject (built-in)

pi names sessions via a tiny side-model call on the first prompt. Claude Code
already auto-generates descriptive session titles (visible in `claude --resume`;
a background model request in interactive and headless/SDK sessions) and supports
explicit naming via `--name` / `/rename`. A hook-based title generator would
duplicate platform behaviour with an extra LLM call — rejected. (SessionStart
hooks can also set `sessionTitle` in JSON output for the rare case where a
custom title is genuinely needed.)

## `notify/` → Notification hook (port)

pi notifies on `agent_end` for multi-turn/long tasks with a desktop notification
+ bell. Claude Code's native `Notification` event fires at the equivalent
completion points and already carries `message`, `title`, and `notification_type`
in the payload — and hooks emit desktop notifications by returning a
`terminalSequence` JSON field (hooks have no controlling terminal; Claude Code
emits the sequence itself, including inside tmux/screen).

Implemented as `Notification` hooks with matcher `success|error` (the two
long-standing notification types, mapped to pi's "task completed / failed"
semantics; version-coupling types like `agent_completed` are deliberately not
matched) invoking `scripts/notify.mjs`, which reads the payload from stdin and
prints the OSC sequence for the detected terminal (Kitty OSC 99, iTerm2/Windows
Terminal OSC 9, default urxvt/Ghostty/Warp OSC 777 — same detection as the pi
`notify` extension). Skipped from the pi original: the LLM response summary
(Claude's notification message is already the summary) and the tmux
session:window.pane title (unavailable to hooks; the plugin title suffices).

## `skill-stats/` → Reject (no equivalent)

pi tracks skills loaded into the system prompt, `/skill:` invocations, SKILL.md
reads, and turns, exposing a `/skill-stats` query. Claude Code exposes none of
the required observability to hooks:

- **No "loaded" event** — nothing fires when a skill enters context, and hooks
  never see system-prompt contents, so the primary "loaded" metric has no source.
- **Partial invocation/read observability only** — `PreToolUse` on the `Skill`
  tool and `UserPromptExpansion` on slash commands would approximate
  invocations, and `PostToolUse` on `Read` would approximate skill reads, but
  the signals are fuzzy (Read covers any file; direct `/skill` typing bypasses
  `PreToolUse`).
- **No query surface** — Claude Code plugin commands are markdown files, not
  scripts, so there is no equivalent of the pi `/skill-stats` command, and
  persistent state would live outside the plugin model.

A half-observable port would diverge from the pi semantics and add moving parts
for little signal. Rejected; Claude Code ships its own usage analytics
(`/usage`, sessions list, statsig) if insights are needed.

## `subagent/` → Reject (native)

pi's `subagent` tool spawns isolated `pi --mode json` processes. Claude Code has
native subagents — the plugin already ships `claude/agents/*.md` (including
`ralph`, `plan`, `strategy`, `ralph-plan`) executed via the built-in Agent/Task
tools with per-session context isolation — so a hook-based workaround would be
strictly worse.

## `agent-modes/` → Reject (no equivalent)

pi switches system prompts + tool restrictions at runtime with a TUI mode
selector. Claude Code exposes no hook or settings surface for dynamic
tool-restriction/prompt-switching of the main agent; the closest equivalents are
native (permission modes like plan mode configured via settings, and subagents
— already covered above). The `--agent <name>` start flag is covered by
`claude --agent` in newer versions. Rejected.