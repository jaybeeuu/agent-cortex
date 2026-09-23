# Idea: Map every cortex tool to a real PI equivalent

## Status
Slice 1 shipped 2026-09 via bead agnt-ctx-f4au: `ask_user` → `ask_questions` and
`skill` → `read` remapped in `token-map.json`; agent-modes startup warnings gone,
verified in real pi sessions. Open follow-ons: full coverage audit of every frontmatter
tool; dedicated skill-tool candidate if prompting proves insufficient.

## Created
2026-09-08

## Problem
On every pi startup, agent-modes warns once per declared tool that has no pi mapping:
`[agent-modes] Tool "ask_user" has no PI equivalent — omitted from the tool set` (plus
`{{TOOL:ask_user}}` token drops). Today `ask_user` and `skill` produce this noise across
the `ralph-plan`, `plan`, and `strategy` modes.

Worse than noise: dropping `ask_user` **silently removes interactive grilling** from
`ralph-plan`/`plan` in pi — a functional gap disguised as a warning. The root cause is
that `token-map.json` declares `pi: null` for `ask_user` and `skill`, and agent-modes
omits null-mapped tools rather than mapping them to the real pi equivalent.

## Who benefits
- The author, in every pi session: clean startup, no recurring warnings.
- `plan`/`strategy`/`ralph-plan` in pi: regain interactive user questioning (via
  `ask_questions`) and a documented, reliable skill-loading path.
- Anyone maintaining cortex: a codified principle so future harness gaps surface loudly
  and are resolved deliberately instead of silently degrading agent capability.

## Proposed outcome
- **Principle**: every tool a cortex agent declares in its frontmatter must have a real
  pi-side representation — either a native pi tool (mapped in `token-map.json`) or a pi
  tool-extension package (found, adopted, or designed). An unmapped tool should be a
  loud error, not a startup warning. "If pi needs more extensions to work, we add more."
- **Coverage audit**: every tool across `agents/*/pi/frontmatter.json` checked against
  the pi toolset; each gap resolved by mapping or by adopting/designing an extension.
- **Immediate remaps**: `ask_user` → `ask_questions` (pi's native structured-questions
  tool); `skill` → documented as "read the listed SKILL.md path" for now (pi has no
  skill tool — skills are context-listed + read-loaded), with a dedicated skill tool
  recorded as a follow-on design candidate if prompting proves insufficient.

## Validity check
- Evidence we already have:
  - The warnings reproduce on every pi startup in agent-nexus (seen 2026-09-08).
    `token-map.json` maps both `ask_user` and `skill` to `pi: null`, and its notes claim
    pi ships no ask tool and no skill tool.
  - That note is outdated for the questioning case: pi's equivalent is `ask_questions`, a
    structured user-question tool provided by the **pi-questions** package (`pi install
    npm:pi-questions`; declared in the author's pi/settings.json) — present in this session's
    toolset, but extension-provided, not native to pi. Mapping `ask_user` to it restores
    grilling in pi modes *when the package is installed*; making the package install
    reproducible is the extension-manifests idea (see `extension-manifests.md`).
  - pi's own skills docs (skills.md, step 3) confirm skills load via `read` and concede
    "models don't always do this" — so a doc-now mapping is legitimate but the
    self-invocation gap is real and acknowledged upstream.
  - Precedent for external tools on pi exists: the pi-hypa package adds `hypa_*` tools
    and context-mode adds `ctx_*` tools; distribution is `pi install npm:@...`.
- Riskiest assumption: that `ask_questions` is a faithful-enough substitute inside
  restricted mode tool lists — i.e. that mode tool filters will admit it and the
  agents actually exercise mid-run questioning in pi.
- What would invalidate this idea:
  - If remapping `ask_user` → `ask_questions` does not restore questioning in pi modes
    (e.g. mode tool lists are a hard allow-list that excludes it), the headline fix is
    a no-op and the problem needs a different shape.
  - If a package scan finds no existing skill tool AND prompting proves sufficient in
    practice, the "skill tool later" half should be dropped or demoted to a note.

## Constraints
- Cortex conventions: extensions stay lightweight (no internal LLM calls); agents/skills
  come from composable sources; `token-map.json` is the single source of truth for
  cross-harness tool naming; changes ship via `pnpm changeset`.
- pi intentionally has no permission popups — the mapping must map onto what pi is, not
  force pi semantics to change.
- agent-modes currently warns-and-omits null tools and passes unknown names through;
  flipping gaps to loud errors changes that contract, and generated copilot/claude
  output (which already has real mappings) must stay stable.

## Next validation step
- (done — shipped via agnt-ctx-f4au) Remap `ask_user` → `ask_questions` in `token-map.json`, then run a pi session in
  `ralph-plan`/`plan` mode and confirm the tool is available and the startup warning is
  gone. If it works, ship that remap first (smallest verifiable slice).
- Scan npm/pi packages for an existing skill-invocation tool before designing one —
  adopt over invent (same stance as the user's marketplace instinct).
- Run the audit: list every tool across `agents/*/pi/frontmatter.json` and mark each as
  mapped-native / mapped-extension / unmapped.

## Notes
- Current pi-mode declarations: `ralph-plan` = bash view edit create grep glob ask_user;
  `plan` adds task read_agent skill; `strategy` adds ask_user skill web_fetch.
- `token-map.json` notes for `ask_user` ("pi intentionally ships no permission-popup/ask
  tool") and `skill` ("pi discovers skills but the agent loads them via read and
  /skill:name") both need updating if the mappings change.
- pi keeps skill affordances present without a skill tool via the always-listed
  "Available skills — invoke when relevant" context block; the doc-now `skill` mapping
  builds on that existing mechanism.
