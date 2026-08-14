# Idea: model-selector

## Status
Backlog idea (not implementation-ready)

## Created
2026-07-12

## Problem
Selecting the right model for a task is manual and brittle. When a model is unavailable (rate-limited, down, or lacking capability), there's no automatic fallback. You have to know which model IDs to type into `/model` and remember which providers offer which capabilities.

## Who benefits
Anyone using PI who runs multiple models/providers. The extension makes model selection declarative: "I want to write code" → extension picks the best available model (and falls back if limits are hit).

## Proposed outcome
A PI extension that defines an abstraction for selecting models based on task/use case. Users declare "use case → model(s) with fallbacks" in config, and the extension handles selection and failover automatically.

Key capabilities:
- **Use-case profiles**: e.g. `code`, `chat`, `review`, `architect` — each maps to a primary model + ordered fallbacks
- **Automatic fallback**: if the primary model returns a 429 or error, drop to the next in the chain
- **Task-based selection**: think "I want this model to write code" instead of choosing a specific model ID
- **Configurable**: profiles defined in settings.json or a dedicated config file

## Validity check
- Evidence we already have: The existing `tiny-model.ts` lib in this repo already shows the pattern of configuring a model by provider/id string and looking it up via `modelRegistry.find()`. The PI extension API supports `before_provider_response` (for catching 429s) and `model_select` events.
- Riskiest assumption: That use-case profiles are a useful abstraction — users may prefer to just name a model family and let fallback be implicit.
- What would invalidate this idea: If PI adds built-in model routing/fallback, or if users find the abstraction adds confusion rather than removing it.

## Constraints
- Must not add LLM calls internally (per extension conventions in AGENTS.md)
- Must work with the existing `modelRegistry` API — no monkey-patching
- Storage/config should go in settings.json or `~/.pi/agent-cortex/` (global, cross-project)

## Next validation step
Sketch the config schema and test it against real usage patterns. Does the profile abstraction hold up for the models/providers you actually use?

## Notes
- Initial conversation during planning session 2026-07-12. Idea recorded as backlog, to be fleshed out when time permits.
- Could draw on patterns from OpenRouter's routing and the existing `modelOverrides` in models.json.
- The `notify` extension already intercepts provider responses — similar pattern for catching rate limits.
