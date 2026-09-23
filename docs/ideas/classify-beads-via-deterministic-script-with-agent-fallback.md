# Idea: Classify beads via deterministic script with agent fallback

## Status
Backlog idea (not implementation-ready)

## Created
2026-09-08

## Problem
`classify-bead` is one of the most frequently invoked skills, yet every invocation spawns a
subagent — even when the classification is settled by fully deterministic lookups (an existing
`implementation-type` label or the legacy `## Type` field) that need no agent at all. The
remaining cases need first-principles rubric judgement, which the skill itself says is simple
enough for "a small, cheap model". Running a full-size agent for all of it burns tokens on
work a script plus a small model could do, and the cost multiplies across every caller:
`create-task`, bead pickups, and ralph's pipeline stages.

## Who benefits
The author — classification is a top-called skill, so token spend per session drops
meaningfully. Callers (`create-task`, pickups, ralph) get near-instant classification without a
subagent round-trip, and keep the same semantics and output contract (AFK/HITL + the applied
`bd tag` command).

## Proposed outcome
A deterministic classifier executable that callers invoke directly instead of spawning an
agent. It resolves the deterministic cases itself (existing label → legacy `## Type` field →
simple heuristics); only when a bead genuinely needs first-principles judgement does it
escalate — ideally to a small/cheap model rather than a full agent. The current skill becomes
the escalation/fallback layer (or a thin wrapper describing the script), preserving the
existing precedence, the AFK bias, and the never-reclassify-a-labelled-bead rule.

## Validity check
- Evidence we already have: classification is one of the top-called skills with visibly high
  token cost; the skill's own workflow already encodes deterministic-first precedence
  (label → `## Type` → rubric), so many calls settle before any rubric reasoning; the skill
  already asserts a small, cheap model suffices for the rubric step; the rubric is small and
  stable, so it ports to a script cleanly.
- Riskiest assumption: the deterministic share of real invocations is actually large — i.e.
  most beads already carry a label or `## Type` field when classified. If most calls genuinely
  need first-principles judgement, scripting the lookups saves little and the win shrinks to
  model size alone. Secondary risk: a small model matches a full agent's rubric accuracy.
- What would invalidate this idea: measurement shows most invocations land in the rubric
  branch; or small-model accuracy is materially worse, causing AFK/HITL misroutes that surface
  as failures at human review gates or in ralph's pipeline; or script+escalation complexity
  across three harnesses (Copilot, pi, Claude Code) outweighs the token saving.

## Constraints
- Must be invocable from every harness where the skill ships (Copilot CLI, pi, Claude Code)
  and from other skills' task-spawning paths.
- Small-model routing depends on per-harness model configuration — ties into the
  `model-selector` / `auto-model-selection` backlog.
- Must preserve the existing rules: never overwrite a recorded label, prefer AFK, and keep the
  reported output contract (classification + applied `bd tag` command).
- The script must not load bead content into a calling agent's context when spawned as a task —
  same isolation property the current skill has.

## Next validation step
Instrument or sample recent `classify-bead` invocations to measure the split between
deterministic lookups (label / `## Type` present) and genuine rubric cases. This single number
decides whether the win is "skip agent spawns entirely for most calls" (large) or "smaller
model only" (modest) — cheap to gather, decisive for scope.

## Notes
- Overlaps with `model-selector.md` and `auto-model-selection.md`: which small model the
  escalation uses is their problem to solve; this idea just wants the deterministic
  classification off the agent path.
- The skill already pushes callers to check `bd label list <id>` before spawning — a script
  makes that check intrinsic instead of a caller-discipline reminder.
- Classification output is a stable, tiny contract (two labels + one `bd tag`), which is what
  makes a scripted rewrite low-risk versus other skills.
