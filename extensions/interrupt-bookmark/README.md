# Interrupt Bookmark Extension

Gives an agent a checkpoint and a rewind, so an interruption does not drag its turns into the
context the original task then has to carry.

PI can rewind a session tree and summarise the branch it abandons. Nothing exposed that as a
deliberate operation, so an interruption — a meeting note, PR feedback to pass on, a Slack todo —
stayed in the live context and the task carried it. This extension adds two tools around pi's own
navigation: one records a resume point, one returns to it.

## Usage

| Tool | Description |
| `interrupt_checkpoint` | Records the current leaf id and returns it |
| `interrupt_resume` | Rewinds to a checkpoint, keeps the abandoned branch under a summary, and ends the turn |

`interrupt_resume` takes `{ checkpointId, summary }`. `summary` describes the interruption; it
reaches pi's summariser as `customInstructions`.

After the turn settles, the rewind happens on its own: the abandoned branch is summarised by pi,
the summary entry is labelled `interrupt`, and the session continues from the checkpoint. The
summary is reported in the session (a notification and an `interrupt-rewind` custom entry), not in
the tool result — the tool call is part of the branch that the rewind summarises.

Nothing is deleted. The abandoned branch stays in the session file and in `/tree`, under the
summary. No model call is made by this extension: the summary comes from pi's own tree-navigation
summariser.

## The two steps, and why they are two

`waitForIdle()` and `navigateTree()` exist on `ExtensionCommandContext` only. The installed
`types.d.ts` (pi 1.5.2) declares them there, and `docs/extensions.md` states the reason: they
deadlock when called while the turn that invoked them is still running. A tool receives
`ExtensionToolContext`, which has no `navigateTree` at all, and the session itself throws while it
is streaming — which it always is during a tool call.

So `interrupt_resume` cannot navigate. It validates the request, records it, and returns
`terminate: true`. An `agent_settled` handler then dispatches `/interrupt-rewind <checkpointId>`
through `sendUserMessage(..., { expandPromptTemplates: true })`, which runs the command rather than
prompting the model. That is the pattern pi documents for a tool that must reach a command-only API
(`docs/extensions.md`, "ctx.reload()").

The declared navigation signature, quoted from
`extensions/agent-modes/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`:

```ts
navigateTree(targetId: string, options?: {
    summarize?: boolean;
    customInstructions?: string;
    replaceInstructions?: boolean;
    label?: string;
}): Promise<{ cancelled: boolean }>;
```

Every option name here is real: `summarize`, `customInstructions`, `replaceInstructions` and
`label`. `label` is applied to the branch-summary entry when `summarize` is set, and to the target
entry when it is not.

## Failure modes

| Case | Behaviour |
| Unknown checkpoint id | Fails before anything is written, naming the id |
| Already at the checkpoint | Reports that there is no interrupt to summarise, and writes nothing |
| Session still streaming | Waits for idle first, then navigates |
| Navigation rejected | Retries once, after another wait for idle; a second failure reports the reason and leaves the session unchanged |
| A second rewind requested | Refused while the first is scheduled |

A failed rewind records `ok: false` and the reason, and tells the caller to continue in the current
context rather than silently carrying the interruption.

## What this extension does not do

- It does not decide when to checkpoint or what to record. The interrupt protocol belongs to the
  agent that asks for the checkpoint.
- It cannot report the summary entry in the tool result, for the reason above.
- It needs a harness that dispatches extension commands. Where the command never runs, the rewind
  reports that nothing was pending and the session is unchanged.

## Claude Code parity

The mechanism differs in kind between harnesses, so it is named once through `token-map.json`: the
`interrupt_rewind` row renders as `interrupt_resume` on pi and as Claude Code's own `/rewind` on
claude. Claude Code checkpoints and rewinds with a user command rather than a model-callable tool,
so prose that names the row describes only what both do — the session returns to an earlier point
and the abandoned turns leave the live context — never a call shape.

## Proven against pi

Behaviour is tested against a complete `ExtensionAPI` double, with a fake session that rejects
navigation while a response is active, exactly as pi does. Both installs are staged and loaded by
`test/pi-extensions-load.test.mjs`.

The session shape a rewind produces was checked against pi's own `SessionManager` separately:
`branchWithSummary()` plus the label change leaves a `branch_summary` entry parented at the
checkpoint, with `fromId` naming the abandoned leaf, every original entry still present, and the
label recorded. A full session run — a real summariser call and a live `/tree` — needs a configured
model and was not exercised here.

## Development

```bash
pnpm test        # behaviour: capture, refusal, dispatch, rewind, retry, branch retention
pnpm typecheck   # tsc --noEmit, which also checks the complete ExtensionAPI double
```
