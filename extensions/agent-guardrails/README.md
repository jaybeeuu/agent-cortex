# Agent Guardrails

Appends behavioural circuit-breakers to the PI system prompt once per user prompt.

This is the first slice of `docs/ideas/improve-pi-system-prompt.md`: the highest-leverage
token reduction is behavioural, not structural. The extension injects a stable block via
the `before_agent_start` hook — which fires once per user prompt, before the agent loop — so
the rules apply to every turn of the run without rewriting Pi's default prompt.

## Rules

- **Circuit-breakers** — two strikes then stop; never repeat a tool call without a stated
  rationale; check in when a cycle produces no progress.
- **Check-in triggers** — stop and present options when retries fail, the requirement is
  ambiguous, a decision with trade-offs is needed, scope must expand, an action is
  destructive, or you are blocked.
- **Atomic changes** — one concern per change; smallest diff that works; no tangential
  refactoring or cleanup.

A structured workflow (a skill or pipeline stage with its own explicit retry and check-in
rules) takes precedence where it is explicit.

## Structure

```
agent-guardrails/
├── README.md           # This file
├── index.ts            # Extension entry point — appends on before_agent_start
├── guardrails.ts       # The guardrails text + appendGuardrails composition
└── guardrails.test.ts  # Composition tests
```

## Testing

```bash
cd extensions/agent-guardrails
node --test --import tsx/esm guardrails.test.ts
```

## Design notes

- The block is a stable constant appended after any chained system-prompt changes, so the
  prompt-cache prefix is preserved.
- `appendGuardrails` is idempotent — a prompt that already carries the marker is returned
  unchanged, so a duplicate extension load cannot double the rules.
