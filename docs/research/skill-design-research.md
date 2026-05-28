# Skill Design Research: Recommendations for agent-cortex

This is a promoted research note.


*Researched: 2026-05-26 — compares `mattpocock/skills` (commit b8be62f) against this repo's skills, cross-referenced with empirical prompt-engineering literature.*

---

## 1. Executive Summary

Three parallel research streams were combined:

1. **Structural analysis** of `mattpocock/skills` (14 active skills, authored by Matt Pocock)
2. **Inventory** of the 31 skills in this repo (`agent-cortex`)
3. **Literature review** of prompt/skill design research (Anthropic, Google, 10+ papers)

The headline finding: **agent-cortex skills are well-structured but systematically over-long, under-exampled, and too passive in their body text.** The mattpocock repo is ahead on progressive disclosure, cross-skill composability, and opinionated philosophy. The research literature backs all three of those design choices.

---

## 2. Comparison: mattpocock/skills vs agent-cortex

### 2.1 Structure

| Dimension | mattpocock/skills | agent-cortex | Delta |
|---|---|---|---|
| YAML front-matter | `name`, `description`, optional `argument-hint`, `disable-model-invocation` | `name`, `description` | Missing 2 fields |
| Description format | "What it does. Use when [natural-language triggers]." | Same — consistent | ✅ Aligned |
| Body sections | No enforced schema; phase headers, checklists, philosophy, anti-patterns | No enforced schema; varies widely | Similar |
| Typical SKILL.md length | 7–160 lines; strict 100-line soft cap | 29–169 lines; soft cap documented but not enforced | agent-cortex skews longer |
| Progressive disclosure | `REFERENCE.md` + named supporting `.md` files linked inline | `REFERENCE.md` on 3 skills only | Under-used in agent-cortex |
| Named supporting docs | `tests.md`, `mocking.md`, `ADR-FORMAT.md`, `CONTEXT-FORMAT.md`, `DEEPENING.md`, etc. | None — overflow goes to `REFERENCE.md` only | mattpocock more granular |
| Checklists | Used as explicit phase gates (`- [ ]`) | Rare | Missing in agent-cortex |
| Cross-skill references | Explicit inline calls: "run `/grill-with-docs`" | Implicit — no inline cross-refs | agent-cortex weaker |
| Shared vocabulary file | `CONTEXT.md` at repo root; skills told to read it | None | Missing in agent-cortex |
| Skill manifest | Flat JSON array of skill paths | Same | ✅ Aligned |
| `disable-model-invocation` | Used for pure prompt-injection skills | Not used | Feature gap |
| Missing SKILL.md | 0 | 1 (`prd-to-epics`) | Bug in agent-cortex |

### 2.2 Tone and Voice

| Dimension | mattpocock/skills | agent-cortex | Delta |
|---|---|---|---|
| Body voice | Imperative, 2nd person ("Read the full issue. Ask.") | Mixed — imperative in some, descriptive in others | Inconsistent in agent-cortex |
| Emphasis style | **bold** for key decisions; minimal CAPS | Occasional ALL-CAPS (`CRITICAL`, `MUST`) | Over-emphasis in agent-cortex |
| Conciseness | Punchy; no filler; "say it once" | Some skills have verbose rationale paragraphs | agent-cortex wordier |
| Examples | Inline code blocks, before/after contrasts, XML output templates | Sparse — only a handful of skills include examples | agent-cortex under-exampled |
| Philosophy | Explicitly baked in (Kent Beck references, banned practices with `DO NOT`) | Workflow-focused; philosophy largely absent | agent-cortex skips the "why" |
| Anti-pattern sections | Common (`## Anti-Pattern:`, before/after code blocks) | Absent | Missing in agent-cortex |
| Negative instructions | Mixed: "DO NOT write all tests first" (hard gate) + positive framing elsewhere | Heavy use of "do not", "never", "don't" | agent-cortex over-uses negatives |

### 2.3 Description Field Quality

Both repos follow the same two-part format: capability sentence + `"Use when..."`. The mattpocock descriptions tend to list *exact user vocabulary* (quoted phrases: `"diagnose this"`, `"let me play with it"`) which is more precise as a routing signal. agent-cortex descriptions are sometimes more abstract.

**mattpocock example** (precise triggers):
> "Disciplined diagnosis loop for hard bugs and performance regressions. Reproduce → minimise → hypothesise → instrument → fix → regression-test. Use when user says 'diagnose this' / 'debug this', reports a bug, says something is broken/throwing/failing, or describes a performance regression."

**agent-cortex example** (vaguer triggers):
> "Create a bead, classify it, and if AFK expand it into pipeline stage child beads plus a HITL PR gate task. Use when creating a new task that should be tracked and moved through implementation and human review gates."

The agent-cortex description describes internal mechanics rather than what the user is trying to accomplish.

---

## 3. Evidence-Backed Recommendations

### Rec 1 — Progressive Disclosure: Split overlong skills

**Evidence**: Anthropic Claude Code best practices: *"Bloated CLAUDE.md files cause Claude to ignore your actual instructions!"* LIMA (Zhou et al., NeurIPS 2023) confirms quality beats quantity — 1,000 curated examples matched GPT-4; adding more degraded focus. Schulhoff et al. (ACL 2024, arXiv:2406.06608) found structure + clarity most consistently effective across 58 techniques.

**Current state**: 12 of 31 agent-cortex skills exceed 100 lines (`run-beads` is 169, `style-code` 151, `qa` 137, `epic-to-tasks` 119). Only 3 have `REFERENCE.md`.

**Recommendation**: Split all skills over ~100 lines. Prefer *named, purpose-specific files* over a catch-all `REFERENCE.md`:
- `REFERENCE.md` — rarely-needed edge cases
- `EXAMPLES.md` — worked examples (if multiple)
- `FORMAT.md` — output schemas / templates
- `WORKFLOW.md` — detailed step expansions

Candidates to split immediately: `run-beads`, `style-code`, `qa`, `epic-to-tasks`, `prd-to-plan`, `tdd`, `ralph`.

---

### Rec 2 — Consistent Imperative Voice in Skill Bodies

**Evidence**: The "26 Principles" paper (Bsharat et al., arXiv:2312.16171, VILA Lab 2024) tested 26 prompting principles on GPT-3.5/4 and LLaMA, finding an average **57.7% quality improvement** on GPT-4. Direct command framing (Principle 16) and specificity (Principle 5) had the largest gains on large models. Anthropic explicitly: *"treat the model as a brilliant but new employee who lacks context on your norms"* — this framing implies 2nd-person imperative.

**Current state**: agent-cortex mixes voices. Some skills are tight and imperative (`review-security`); others narrate what the skill *will* do rather than commanding the agent to do it.

**Recommendation**:
- Skill body: imperative, 2nd person. "Run `gitleaks protect --staged`", not "The skill runs gitleaks."
- Description field: third-person declarative. "Scans git changes for secrets."
- Remove all-caps emphasis (`CRITICAL`, `MUST`). Anthropic Claude Code notes: *"Where you might have said 'CRITICAL: You MUST use this tool when...', you can use more normal prompting like 'Use this tool when...'"* — over-emphasis backfires with modern models.

---

### Rec 3 — Replace Negative Instructions with Positive Framing

**Evidence**: Anthropic Prompting Best Practices gives an explicit side-by-side:
> ❌ `"Do not use markdown in your response"`
> ✅ `"Your response should be composed of smoothly flowing prose paragraphs."`

The "26 Principles" paper lists "affirmative instructions, no 'don't'" as Principle 3 with consistent cross-model gains. Mechanistically, negative instructions require the model to hold a prohibited concept in working memory and suppress it — more error-prone than activating the desired pattern directly.

**Current state**: agent-cortex skills have frequent negative phrasing: "Do not work a HITL bead", "Don't commit without scanning", "Never use relative paths."

**Recommendation**:

| Instead of | Use |
|---|---|
| "Do not work a HITL bead" | "Inform the user it requires human action and stop" |
| "Never use relative paths" | "Use absolute paths — agents may change CWD mid-session" |
| "Don't commit without scanning" | "Always run `review-security` before committing" |

Reserve "do not" for hard correctness/safety constraints that genuinely need an explicit backstop. For stylistic preferences, positive framing only.

---

### Rec 4 — Include Rationale for Non-Obvious Rules

**Evidence**: Anthropic best practices: *"Providing context or motivation behind your instructions, such as explaining why such behavior is important, can help Claude better understand your goals and deliver more targeted responses. Claude is smart enough to generalize from the explanation."* Chain-of-Thought (Wei et al., NeurIPS 2022, arXiv:2201.11903) showed that *reasoning traces* — not just input→output — dramatically outperform bare instructions. The "26 Principles" paper Principles 2 and 5 (explain purpose, specify stakes) were among the highest-impact on GPT-4.

**Current state**: agent-cortex skills state rules but rarely explain them. A reader (or agent) encountering "Use absolute paths" won't know why.

**Recommendation**: Add one-sentence rationale for any non-obvious rule. Pattern:

```markdown
Use absolute paths — agents may change CWD mid-session, breaking relative references.
```

Do **not** write paragraphs of rationale. One sentence is enough; the model generalises from it.

---

### Rec 5 — Add Worked Examples to Key Skills

**Evidence**: Chain-of-Thought (Wei et al., NeurIPS 2022): *"prompting a 540B-parameter language model with just 8 chain-of-thought exemplars achieves state-of-the-art accuracy on GSM8K, surpassing even fine-tuned GPT-3."* Anthropic: *"A few well-crafted examples can dramatically improve accuracy and consistency."* Recommendation: 3–5 examples, wrapped in `<example>` tags, covering diverse cases. APE (Zhou et al., ICLR 2023, arXiv:2211.01910) found example-seeded instructions outperformed hand-written instructions on 19/24 tasks. Selective Annotation (Su et al., arXiv:2209.01975) showed *diverse* examples give a 12.9% relative gain over random ones.

**Current state**: most agent-cortex skills have no worked examples. `run-beads` has a `---REPORT---` output template; `review-security` shows exact commands. These are the strongest skills.

**Recommendation**: For each skill, identify what the agent produces as output and include 1 complete worked example. For CLI-heavy skills, show exact commands with substitution markers. For decision-heavy skills, add a decision table.

```markdown
## Example Output

---REPORT---
Bead: bd-42 "Add login page"
Status: ✅ done
PR: https://github.com/org/repo/pull/99
---
```

Extract to `EXAMPLES.md` if more than ~30 lines.

---

### Rec 6 — Add Explicit Phase Gates (Checklists)

**Evidence**: Schulhoff et al. (ACL 2024) found structured verification steps consistently reduce hallucination and task-deviation. Anthropic Building Effective Agents: *"Give Claude a way to verify its work."* The mattpocock `diagnose` and `tdd` skills use `- [ ]` checklists as explicit gates between phases — the agent cannot proceed without the checklist being satisfied.

**Current state**: agent-cortex multi-phase skills (`ralph`, `run-beads`, `tdd`, `epic-to-tasks`) describe phases in prose but have no explicit verification gates.

**Recommendation**: For any multi-phase skill, add a short checklist at the end of each phase:

```markdown
## Phase 1 — Explore

- Read the bead description and all linked files
- Identify the affected modules
- [ ] Can you describe the change in one sentence?
- [ ] Do you know which files will change?

Move to Phase 2 only when both boxes are checked.
```

---

### Rec 7 — Sharpen Description Trigger Vocabulary

**Evidence**: Anthropic Building Effective Agents: *"Think of this as writing a great docstring for a junior developer on your team."* For agents, descriptions are the only routing signal. FLAN (Wei et al., ICLR 2022) showed instruction-tuned models generalise from natural language task descriptions — use the vocabulary a user would *actually speak*, not internal system jargon. Anthropic tool use note: `"Use when"` language *actively counteracts* the model's default tendency to solve problems without invoking tools.

**Current state**: some agent-cortex descriptions describe internal mechanics rather than user intent. E.g., `create-task`: *"Use when creating a new task that should be tracked and moved through implementation and human review gates"* — references internal workflow terms a user wouldn't say.

**Recommendation**: Rewrite descriptions to lead with user-vocabulary triggers. Include 2–4 quoted phrases or scenario patterns a user might say:

```yaml
description: >
  Break a piece of work into a tracked task with a full implementation pipeline.
  Use when the user says "create a task", "let's track this", "add a bead", "file this 
  as a ticket", or wants to turn a conversation into actionable work.
```

---

### Rec 8 — Establish Composability via Explicit Cross-References

**Evidence**: Anthropic Building Effective Agents promotes "orchestration" patterns where agents compose tools rather than re-implementing logic. mattpocock's skills reference each other by name inline (e.g., "run `/grill-with-docs`"), creating a composable skill library. Meta-prompting (Suzgun et al., arXiv:2401.12954) found high-level orchestration instructions (+17.1%) outperform monolithic step-by-step skills.

**Current state**: agent-cortex skills are largely self-contained monoliths. `ralph` calls `run-beads` but this is the only explicit cross-reference.

**Recommendation**: Where a skill currently duplicates logic from another skill, replace the duplication with an explicit invocation: *"Run the `review-security` skill before committing."* Document the skill dependency graph informally in `AGENTS.md`.

---

### Rec 9 — Add `argument-hint` to Input-Driven Skills

**Evidence**: Anthropic tool design (Building Effective Agents, Appendix 2): *"Is it obvious how to use this tool? ... This is especially important when using many similar tools."* The `argument-hint` front-matter field (present in mattpocock's plugin schema) surfaces a prompt to the user at invocation time — preventing input ambiguity before the skill runs.

**Current state**: agent-cortex plugin schema doesn't include `argument-hint`. Skills like `triage-issue`, `write-a-ticket`, `run-beads` take implicit input that could benefit from a hint.

**Recommendation**: Add `argument-hint` support to `plugin.json` schema and add hints to skills that take input:

```yaml
argument-hint: "Describe the bug or paste the error message"
```

---

### Rec 10 — Fix prd-to-epics Missing SKILL.md

**Current state**: `skills/prd-to-epics/` directory exists in the repo but has no `SKILL.md`. It cannot be invoked.

**Recommendation**: Either write the missing `SKILL.md` or remove the directory. This is a straightforward bug.

---

## 4. Prioritised Change List

| Priority | Change | Effort | Evidence strength |
|---|---|---|---|
| P0 | Fix missing `prd-to-epics/SKILL.md` | Low | N/A — broken |
| P1 | Split skills > 100 lines (7 candidates) | Medium | Strong — Anthropic production data |
| P1 | Convert negative instructions to positive framing | Low | Strong — 26 Principles paper, Anthropic |
| P1 | Sharpen description trigger vocabulary (use user-vocab) | Low | Strong — FLAN, Anthropic tool use docs |
| P2 | Add imperative voice to passive skill bodies | Medium | Strong — 26 Principles paper |
| P2 | Remove ALL-CAPS emphasis | Low | Medium — Anthropic Claude Code guide |
| P2 | Add 1-sentence rationale to non-obvious rules | Low | Strong — CoT, 26 Principles |
| P2 | Add worked examples to output-producing skills | Medium | Strong — Wei et al. CoT, Anthropic |
| P3 | Add phase-gate checklists to multi-phase skills | Medium | Medium — Schulhoff survey, mattpocock pattern |
| P3 | Add explicit cross-skill references | Low | Medium — Meta-prompting paper |
| P3 | Add `argument-hint` support and populate | Medium | Medium — Anthropic tool design |

---

## 5. What mattpocock Does That We Should Consider Adopting Wholesale

These are patterns present in `mattpocock/skills` that have no equivalent here and are backed by evidence:

1. **`CONTEXT.md` at repo root** — a shared ubiquitous-language glossary that all skills read. Prevents terminology drift across skills and gives the agent grounding in project domain terms. (See also: `ubiquitous-language` skill in agent-cortex — but it writes per-project, not per-skill-repo.)

2. **Philosophy sections in skills** — `tdd` doesn't just describe TDD, it argues *why* horizontal slicing is wrong. This bakes intent into the skill so the agent handles novel cases correctly (backed by CoT rationale evidence).

3. **`disable-model-invocation: true`** — for skills that *are* the prompt (pure injection, no interpretation). Prevents the model from summarising/transforming the skill content before executing it.

4. **Composability by design** — skills reference each other by slash-command inline. This keeps each skill shorter and creates a network of reusable primitives rather than monolithic blobs.

---

## 6. What We Do Well That mattpocock Doesn't

1. **Richer plugin manifest** — MCP server declarations, richer metadata.
2. **Bundled scripts** — `run-beads`, `create-task`, `review-security`, `record-idea` all include deterministic scripts that reduce regeneration of boilerplate. mattpocock has this for `diagnose` and `git-guardrails` only.
3. **Task tracking integration** — `bd` / beads integration is deeply embedded across skills; mattpocock uses GitHub Issues directly without an equivalent agent-native tracker.
4. **HITL/AFK distinction** — explicitly modelled and surfaced in `run-beads`, `classify-bead`, etc. mattpocock's `to-issues` introduces the concept but doesn't enforce it system-wide.

---

## Sources

| Source | Key Findings Used |
|---|---|
| Anthropic Prompting Best Practices | Positive framing, numbered steps, XML tags, 3–5 examples, rationale inclusion, query placement (+30%) |
| Anthropic Building Effective Agents | Tool documentation = system prompt importance; ACI design; poka-yoke; verification criteria |
| Anthropic Claude Code Best Practices | Conciseness critical; bloated files → ignored rules; positive examples > negative instructions; no ALL-CAPS |
| Google Vertex AI Clear Instructions | Specificity + constraints → precise output |
| Bsharat et al. (2024) arXiv:2312.16171 | 26 prompting principles; avg +57.7% quality / +36.4% correctness on GPT-4 |
| Wei et al. (2022) arXiv:2201.11903 (CoT) | 8 CoT examples beat fine-tuned models; reasoning traces > bare instructions |
| Wei et al. (2021) arXiv:2109.01652 (FLAN) | Natural-language commands generalise better than passive descriptions |
| Zhou et al. (2022) arXiv:2211.01910 (APE) | Example-seeded instructions beat human instructions on 19/24 tasks |
| Zhou et al. (2023) arXiv:2305.11206 (LIMA) | 1,000 curated examples ≈ GPT-4 quality; quality >> volume |
| Suzgun et al. (2024) arXiv:2401.12954 | High-level orchestration +17.1% vs standard prompting |
| Schulhoff et al. (2024) arXiv:2406.06608 | ACL survey of 58 techniques; structure + clarity most consistently effective |
| mattpocock/skills (commit b8be62f) | Structural reference; progressive disclosure; composability; checklists |

[Inspirations](../inspirations.md)
