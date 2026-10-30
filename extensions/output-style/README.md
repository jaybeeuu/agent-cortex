# Output Style

Appends the always-on reply shape to the PI system prompt once per user prompt.

This is the second slice of `docs/ideas/improve-pi-system-prompt.md`: the first
(`agent-guardrails`) stops wasted work; this one stops the answer getting buried in
it. The extension injects a stable block via the `before_agent_start` hook — which
fires once per user prompt, before the agent loop — so the rules apply to every
turn of the run without rewriting Pi's default prompt.

## Rules

- **Lead with the action** — the first line is the answer, command, path, or next
  action; multi-step work is numbered; the reply ends with one next step.
- **Keep the prose short** — no preamble, no recap, no closing offer; five items
  per list at most; one topic per reply.
- **Write Simplified Technical English (ASD-STE100)** — active voice, 20-word
  sentences for instructions and 25-word sentences for description, verb over
  noun, one word one meaning, literal words, no marketing adjectives, articles
  kept.
- **Restate the context** — never cite a bead, ticket, phase, or stage by ID alone;
  say what it is in plain words first, and restate state after a gap or topic
  switch.

The rules shape the reply, never the work. When a rule would delete the answer,
the task wins.

## Structure

```
output-style/
├── README.md              # This file
├── index.ts               # Extension entry point — appends on before_agent_start
├── output-style.ts        # Loads the block + appendOutputStyle composition
├── output-style.md        # The block text (single source, also shipped to Claude)
├── output-style.test.ts   # Composition tests
├── package.json
└── tsconfig.json
```

## Testing

```bash
cd extensions/output-style
node --test --import tsx/esm output-style.test.ts
```

## Design notes

- The block is a stable constant appended after any chained system-prompt changes,
  so the prompt-cache prefix is preserved.
- `appendOutputStyle` is idempotent — a prompt that already carries the marker is
  returned unchanged, so a duplicate extension load cannot double the rules.
- Separate from `agent-guardrails` because it is a different failure: guardrails
  govern *whether* work continues, this governs *how the result is reported*.
- The prose lives in `output-style.md`, not in the TypeScript, because there is a
  second consumer: `agent-cortex install claude` wraps that file in the managed
  `~/.claude/CLAUDE.md` section. One file, two harnesses, no drift.
