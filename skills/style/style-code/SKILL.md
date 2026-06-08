---
name: style-code
description: Defines coding style, conventions, and architectural preferences. Use when writing, editing, or reviewing code — or when you need a "style review", want to check "naming conventions", or are deciding "module boundaries".
---

# Code Style

## When to use

- Writing new code, editing existing code, or reviewing a pull request.
- Deciding between type approaches, naming strategies, or module boundaries.
- Asked for a "style review", "does this look right", or "what's the convention here".

## When NOT to use

- Writing tests or deciding test strategy — use `style-tests` or `tdd` instead.
- Communication tone, document structure, or external writing — use `style-comms`.
- Deciding what and whether to document — use `style-documentation`.

## Philosophy / rationale

- **Small, focused changes beat broad refactors.** Every change should answer one question. Scope creep is the most common source of defects in an otherwise clean change.
- **Clarity over cleverness.** Code is read many more times than it is written. Clever code optimises for the writing moment; clear code optimises for every subsequent reading.
- **Validate at system edges, trust the type system within.** Inbound data from API ingress, deserialisation, or inter-service communication is untrusted until validated. Within application boundaries, trust the type system to enforce correct calls — don't re-validate at every internal module boundary.
- **Prefer result objects for domain errors; reserve exceptions for emergencies.** Expected failures — validation errors, not-found, conflict — belong in a typed result the caller can handle. Thrown `Error` should signal something genuinely broken: a programming mistake, an invariant violation, or unrecoverable state.
- **Deep modules beat shallow ones.** A tight public API with complexity hidden behind it is easier to use, test, and change than a flat sprawl of interdependent helpers.
- **Abstraction must earn its keep, but local helpers are free.** An abstraction extracted into a shared module before its shape is proven nearly always guesses wrong. But extracting a local helper to clarify domain logic is always worthwhile — even at first use. The goal is readable code, not zero duplication.

## Workflow

1. **Orient.** Run the `tdd` skill for the red-green-refactor loop. Style rules guide the shape of the code you produce inside that loop.

2. **Define types and boundaries first.** Model domain concepts with named types, interfaces, discriminated unions, or typed result objects. Keep types close to the service or package that owns them. Validate unknown data at system edges (API ingress, deserialisation, inter-service boundaries) using runtime validators — treat incoming data as `unknown` until checked. Within the application, trust the type system to enforce correct calls.

3. **Name for clarity.** Use descriptive names drawn from the project's ubiquitous language. Do not invent synonyms for established domain terms. If the language isn't yet defined for this area, run `grill-with-docs` to extract it before naming. Use consistent suffixes: `Props`, `Options`, `Context`, `State` where they aid recognition. Name factories and builders with explicit verbs (`create`, `make`, `build`, `resolve`, `parse`, `compile`, `fetch`, `read`, `write`).

4. **Structure with ownership in mind.** Keep ingress, processing, API, CLI, and infrastructure concerns in separate modules. Split modules when it sharpens bounded-context ownership; do not split just to reshuffle code.

   **Co-locate by domain, not by technical type.** All the files for a given feature or bounded context — types, actions, reducers, selectors, thunks, components, tests — live alongside each other. Do not group files by what they *are* ("all selectors here, all thunks there"). Group them by what they *belong to* ("everything for the accounts domain here"). This keeps domain boundaries visible in the filesystem and makes it safe to rename, extract, or delete a feature without hunting across a dozen type-based directories.

5. **Apply UI and state patterns.** Prefer small functional components with explicit props interfaces. Use CSS Modules when the stack supports them. Keep state transitions visible and predictable — encapsulate state behind hooks, selectors, or dedicated state modules. Keep derived state clearly separated from primitive state.

6. **Review against the checklist below.** Read the diff once as its reviewer before committing.

## Red Flags

- **Reaching for `any` or non-null assertions.** Every `any` is a blind spot in the type system. If unavoidable, keep it narrow and function-scoped.
- **Broadening scope.** A change that fixes a bug and also renames three modules and extracts an abstraction is three changes. Split it.
- **Skipping edge validation.** Inbound data at API ingress, deserialisation, or inter-service boundaries is untrusted until validated. Within the application, trust the type system. A missed edge validation silently poisons downstream callers.
- **Unstructured errors.** A thrown string or `{ message }` object leaves the caller guessing what failed and why. Prefer typed result objects for expected domain failures — use thrown `Error` only when something has genuinely gone wrong (programming error, invariant violation, unrecoverable state).
- **Large modules with mixed concerns.** A file doing data loading, state orchestration, and rendering is three modules waiting to be extracted.
- **Premature cross-module abstraction.** Extracting a shared utility into a common module before the pattern has proven itself across multiple callers nearly always guesses the wrong shape. Local helpers that clarify intent are fine at first use — keep them within the module boundary until the pattern repeats.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I'll just use `any` here — it's a small edge case" | Every `any` is a type system blind spot. If unavoidable, keep it narrow, local, and documented. |
| "I'll clean this up in a follow-up" | Follow-ups rarely happen. Keep the change proportionate but correct. |
| "This is too small for edge validation" | The smallest unvalidated input at a system edge causes the most confusing downstream failures. Validate incoming data once at the boundary and let the type system carry it from there. |
| "I'll add types later" | Types are cheapest at write time. Adding them later is a refactor you will skip. |
| "The existing code already does it this way" | Existing patterns may predate this guide. Follow the guide unless changing it would inflate scope beyond the task. |
| "I'll throw an Error for this validation failure" | Expected domain failures should be typed results the caller can handle. Reserve thrown `Error` for things that are truly broken. |
| "I'll extract this into a shared util — it might be useful later" | Extract locally first if it clarifies the code. Promote to shared only when at least a third real caller emerges. Guessing the shape before then wastes time and creates coupling. |

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| Test-first development loop | `tdd` |
| Test writing conventions | `style-tests` |
| Building or hardening the project's ubiquitous language | `grill-with-docs` |
| Communication tone and document structure | `style-comms` |
| What and whether to document | `style-documentation` |
| Surfacing architectural friction and deepening shallow modules | `improve-codebase-architecture` |
| Secrets and credential scanning | `review-security` |

## Examples

See `REFERENCE.md` for the full set. The most common patterns:

### Types at boundaries

| Instead of… | Write… |
|---|---|
| `function handleRequest(raw: any) { ... }` with no validation | `function handleRequest(raw: unknown): HandlerResult { ... }` validated at the ingress boundary |
| `const user = JSON.parse(raw)` with unchecked cast | `const user = parseUser(JSON.parse(raw))` validated with `parseUser` at the deserialisation edge |

### Naming

| Instead of… | Write… |
|---|---|
| `function process(items) { ... }` | `function resolveOverdueAccounts(accounts: Account[]) { ... }` |
| `interface Config { ... }` | `interface ExportOptions { ... }` |

### Scoping

| Instead of… | Write… |
|---|---|
| One commit fixing a bug, renaming a module, and adding an abstraction | One commit per concern, each reviewable on its own |

## Verification checklist

- [ ] Change is focused on one concern — no scope creep
- [ ] External inputs validated at system edges (API, deserialisation, inter-service)
- [ ] Exported APIs and return types are explicit (no inferred `any`)
- [ ] Names are descriptive and drawn from the project's ubiquitous language
- [ ] No `any`, broad casts, or non-null assertions without narrow scoping
- [ ] Types are co-located with the module that owns them
- [ ] Modules are split by ownership, not just for reshuffling code
- [ ] State transitions are explicit and encapsulated behind a clear API
- [ ] Tests and docs updated where behaviour changed
- [ ] Staged changes scanned with `review-security` before committing
