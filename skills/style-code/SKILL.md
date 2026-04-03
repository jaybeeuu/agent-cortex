---
name: style-code
description: "Coding style and conventions for jaybeeuu. Use this before writing, editing, or refactoring any code — including new files, bug fixes, features, tests, and scripts."
---

# Jaybeeuu Style

## Priority Order

1. **Explicit instructions first** — follow direct user instructions and any local agent files (e.g. `AGENTS.md`, `CLAUDE.md`) above all else.
2. **This style guide second** — apply these principles to all new code, ambiguous choices, and cross-cutting design work.
3. **Existing repository structure last** — treat the current shape of the codebase as the lowest-priority input; do not let it override this guide unless changing it would inflate scope.

**Scope exception**: if conforming to this guide requires touching code outside the immediate task — refactoring existing files, renaming conventions, restructuring modules — do not do it. Note the deviation instead and move on. Style improvements to pre-existing code are only in scope when the task explicitly asks for them.

## Core Priorities

Optimize for clarity, explicit boundaries, and changes that stay proportionate to the task.

- Make small, focused changes. Do not broaden the scope without a clear need.
- Prefer readable, explicit code over clever or compressed code.
- Keep public APIs strongly typed and self-documenting.
- Validate unknown data at system boundaries instead of assuming it is already correct.
- Keep behavior changes, tests, docs, and types aligned.
- Favor practical engineering choices over abstraction for its own sake.

## Architectural Preferences

Keep ownership, boundaries, and validation responsibilities explicit.

- Prefer a TypeScript-first architecture with strict, explicit types at module boundaries.
- Prefer a domain-driven design approach with explicit bounded contexts and clear ownership of behavior, data, and public contracts.
- Model domain concepts with named types, interfaces, discriminated unions, and typed result objects.
- Keep domain types as close as possible to the service or package that owns them.
- Public contracts should be published by the owning package and consumed from there rather than copied into a separate catch-all contract package.
- Keep ingress, processing, API, CLI, and infrastructure concerns in separate modules or packages; do not blur domain boundaries for convenience.
- Use a shared kernel only for small, stable primitives that are truly generic and belong to no particular bounded context.
- Keep parsing and validation close to the edge of the system.
- Reuse existing local utilities for validation, conversion, errors, or state rather than introducing parallel patterns.
- Prefer small composable modules over large files with mixed responsibilities.

## TypeScript Style

Make module boundaries explicit in the type system and keep advanced typing justified.

- Export explicit interfaces for component props, configuration objects, and other public shapes.
- Use type aliases or interfaces when they improve clarity; avoid anonymous object types in exported APIs.
- Use generics when they clarify the contract, not to show off type-system tricks.
- Validate and assert shapes especially at the boundaries rather than assuming them to be correct.
- Prefer `unknown` to `any`.
- Avoid `any`, broad casts, and non-null assertions. If one is unavoidable, keep it narrow and local (e.g. function scoped).
- Prefer return types on exported functions and on components.
- Use domain-oriented names for type parameters when possible, for example `Value`, `Options`, `Props`, or `FailureReason`.

## Validation And Error Handling

Validate unknown data at the edge and make failures specific enough to act on.

- Treat external or deserialized data as `unknown` until validated.
- Prefer runtime validators and assertions over unchecked casts.
- Make validation failures specific and actionable.
- Preserve context in errors so the caller can understand what failed and why.
- Prefer typed result shapes or typed errors over loose booleans or stringly-typed failure handling.
- Fail loudly on invalid input rather than letting bad data leak deeper into the system.

## Naming And File Layout

Choose names and layouts that make ownership and intent obvious.

- Prefer descriptive names over short ones.
- Use consistent suffixes such as `Props`, `Options`, `Context`, and `State` where they improve recognition.
- Name hooks with a `use` prefix.
- Name factories and builders with explicit verbs such as `create`, `make`, `build`, `resolve`, `parse`, `compile`, `fetch`, `read`, or `write`.
- Use `index.ts` files to re-export the intended public API explicitly. Prefer named re-exports over barrel re-exports.
- Co-locate related files: component, CSS module, tests, and small feature-specific helpers should sit near each other.

## UI And Component Style

Keep components small, explicit, and easy to compose.

- Prefer small functional Preact or React-style components with explicit props interfaces.
- Use CSS Modules as the default styling approach when the stack supports them.
- Keep styles scoped and component-local instead of relying on broad global selectors.
- Allow composition by accepting optional `className` props where appropriate.
- Use semantic markup and meaningful accessible names before introducing test-only hooks.
- Keep rendering logic straightforward. Extract helpers or hooks when a component starts mixing data loading, state orchestration, and rendering concerns.

## State And Data Flow

Make state transitions visible, predictable, and local to clear APIs.

- Prefer explicit state models over implicit shared mutable state.
- Keep derived state clearly separated from primitive state.
- Encapsulate state access behind hooks, selectors, or dedicated state modules.
- Prefer predictable data flow and explicit actions over incidental mutation.
- Keep async state transitions visible in the API and in tests.

## Test Style

Test behavior and public contracts with the narrowest reliable validation first.

- Test behavior and contracts, not implementation trivia.
- Use simple `describe` and `it` structure with direct assertions.
- Keep test data inline unless reuse is genuinely valuable.
- Prefer deterministic tests and fix flakiness rather than normalizing it.
- Add tests where behavior changes or public contracts move.

## Documentation Tone

Write documentation that is concise, practical, and immediately useful.

- Keep documentation concise, practical, and directly useful.
- Explain how to use a package, function, or command before explaining theory.
- Prefer realistic examples over placeholder-heavy pseudo-examples.
- Do not add comment noise; rely on clear names first and add comments only where intent would otherwise be hard to infer.

## What To Avoid

- Broad refactors that are not required for the task.
- New abstractions that duplicate existing project patterns.
- Implicit assumptions about input shape or environment.
- Unstructured error objects or swallowed failures.
- Large components or modules that mix unrelated responsibilities.
- Tests that depend on fragile DOM structure when semantic selectors or stable hooks are available.
- Hand-editing generated output, compiled directories, coverage reports, or other artifacts.

## Checklist Before Finishing

- Is the change focused and proportionate to the task?
- Are external inputs validated before use?
- Are exported APIs and return shapes clearly typed?
- Are names explicit and domain-oriented?
- Are bounded-context ownership and service boundaries still clear after the change?
- Does the code favor clarity over cleverness?
- Are tests and docs updated where behavior changed?
