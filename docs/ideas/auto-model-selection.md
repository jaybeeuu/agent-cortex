# Idea: Auto-Model Selection Plugin

## Status
Backlog idea (not implementation-ready) — **direction: evaluate and adopt existing package**

## Why it might be useful
PI has no intelligent model selection. Users must manually choose models, which means they either over-provision (expensive models for simple tasks) or under-provision (weak models for complex work). Rate limits hit without warning, forcing manual model switching mid-session. An auto-selection plugin would optimize cost/performance by matching model capability to task complexity, and provide seamless fallbacks when rate limits are hit.

## How we might do it
**Evaluate and adopt an existing PI extension** rather than building from scratch. The ecosystem already has well-maintained packages that cover task-based routing and rate-limit fallbacks. The goal is to:

1. **Evaluate the top candidates** (see "Packages to evaluate" below)
2. **Pick the best fit** for agent-cortex's workflow (beads, pipeline stages, HITL/AFK classification)
3. **Install and configure** it, possibly with light customisation if needed
4. **Document** the chosen package and configuration in agent-cortex docs

## Packages to evaluate (in priority order)
**Top candidates — cover both task-based routing AND fallbacks:**
1. **`@kylebrodeur/pi-model-router`** — per-turn routing to high/medium/low tiers based on task intent, context size, budget, with automatic fallback chains and rate-limit recovery. Well-documented fork of yeliu84's original.
2. **`pi-auto-router`** — multi-provider routing with same-request failover, budget-aware policies, and quota-aware fallback.
3. **`pi-tiered-router`** — routes different *phases* (planner/validator/executor/tool-parser) to different models. Quality-first, not cost-saving.

**Fallback-only (simpler, if routing is overkill):**
- **`pi-auto-models`** — Claude→Codex quota switching with 429/529 recovery
- **`pi-provider-fallback`** — cross-provider fallback chain with TUI config

**Evaluation criteria:**
- Does it integrate cleanly with PI's existing provider/model system?
- Does it respect user's explicit model choice, or override it?
- How does it handle context window mismatches on fallback?
- Is it configurable per-project?
- Does it have fallback chains or just single fallback?
- Rate-limit detection and retry logic
- Documentation quality and maintenance status

## When to think about it
- After current feature stabilisation (refactor-to-template epic, npm publishing, system prompt improvements)
- Not blocked, but benefits from stable extension infrastructure

## Priority
Medium / backlog — valuable for cost optimisation and reliability, but not urgent. Current manual model selection works, just isn't optimal.

## Open questions
- How to classify task complexity? Heuristics (file count, prompt length, keywords)? Or let user tag tasks?
- What defines a "model class"? Cost tier, context window size, reasoning capability, speed?
- Should the plugin override the user's explicit model choice, or only activate when no model is selected?
- How to handle context window mismatches when falling back (e.g., 200k → 128k)?
- Should this be configurable per-project (different policies for different repos)?

## Existing packages in the ecosystem
Several published packages already address parts of this problem:

### Fallback / rate-limit recovery
- **`pi-provider-fallback`** — cross-provider fallback with interactive TUI config
- **`pi-auto-models`** — primary/fallback switching on quota (Claude→Codex default), 429/529 recovery

### Task-based / tier routing
- **`pi-model-router`** (yeliu84, forked by @kdejaeger and @kylebrodeur) — per-turn routing to high/medium/low tiers based on task intent, context size, budget, with automatic fallbacks
- **`pi-model-auto`** — routes by Low/Medium/High/Ultra capability modes per turn
- **`pi-tiered-router`** — routes different phases (planner/validator/executor/tool-parser) to different models

### Full auto-router with failover
- **`pi-auto-router`** — multi-provider routing with same-request failover, budget-aware policies
- **`@ifi/pi-extension-adaptive-routing`** — adaptive routing with local telemetry persistence

### Model selection (manual)
- **`pi-model-switch`** — direct model switching tool
- **`pi-model-select`** — `/select-model` with favourites and fuzzy search

## Notes
- **The ecosystem is active** — this space is already well-served. Before building, evaluate whether an existing package (especially `pi-model-router` or `pi-auto-router`) already meets the need.
- **Gap analysis needed**: compare existing packages against the original requirements (task-based class selection + rate-limit fallbacks) to see if anything is genuinely missing.
- **Partial solutions exist in PI core**: OpenRouter's routing config supports fallbacks and provider ordering, but only within OpenRouter. Cross-provider fallback requires an extension.
- **Implementation approach** (if building): likely a PI extension that registers a "smart-router" provider, which internally delegates to real providers based on task classification and availability.
- **Research done**: reviewed PI docs on providers, models, and extensions. Searched npm and pi.dev for existing packages.
