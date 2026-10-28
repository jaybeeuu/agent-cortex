# session-start

A PI extension that injects, at the start of every session, the project's context files:

- `AGENTS.md`
- `docs/user-preferences.md`

Paths are relative to the session working directory (`ctx.cwd`); missing or empty files are
skipped. Content is injected as a hidden `session-start` message on `before_agent_start`, so it
reaches the model without cluttering the transcript UI.

## No skill list here — on purpose

Earlier versions of this extension appended a hand-written blurb advertising three skills with
`/skill:<name>` syntax. Both halves were wrong:

- pi has no `/skill:` resolver — nothing maps that token to a read. Skills are used by reading
  the `SKILL.md` path that pi lists.
- pi's own system prompt already lists **every** discovered skill with its absolute `SKILL.md`
  path, so a local three-skill list was incomplete and drifted from `skills/` silently.

The blurb is gone and `index.test.ts` pins the absence of both `/skill:` syntax and hardcoded
skill names. Keep the authoritative list in `skills/`; do not reintroduce it here.

## Installation

Bundled with the `agent-cortex` PI package — install the package for auto-discovery:

```bash
pi install git:https://github.com/jaybeeuu/agent-cortex
```

## Development

```bash
pnpm --filter @agent-cortex/session-start test
pnpm --filter @agent-cortex/session-start typecheck
```
