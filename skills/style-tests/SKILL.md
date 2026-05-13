---
name: style-tests
description: Test writing style and conventions for jaybeeuu. Use this before writing, editing, or reviewing any unit, integration, or e2e tests.
---

# Test Style

## Core Principles

### Test behaviour, not implementation

Don't assert that a function was called; assert that an outcome was achieved. Internal mechanics
are irrelevant. A passing test should not break when you refactor internal structure — only when
observable behaviour changes. If a test fails after a refactor that didn't change behaviour, the
test was wrong.

### Sociable tests over mockery

Favour integration tests over unit tests. The line between integration and unit should be blurry.
Reserve unit tests for complex functional logic that benefits from tight isolation. Use e2e smoke
tests to prove the system hangs together. This is the **testing trophy**, not the testing pyramid.

### Weight vs. value

Every test has a cost: time to write, run, and maintain. Only write a test when its value exceeds
its weight. Prune tests that duplicate coverage already provided by types, linting, or other tests.
Each behaviour should be covered at least once — ideally only once.

## Setup and Data

### Inline what matters

Setup state that is asserted on or that establishes the test condition must appear **inline in the
test**, not hidden in a helper or hook. A reader should be able to see exactly why the test passes
or fails without leaving the test body.

### Factories for sensible defaults

Use factory/builder helpers for complex objects. Keep them simple and deterministic. Any value that
is asserted on or that changes the test condition must be an explicit override — never buried in a
factory default.

### No before/after hooks

Tests must be fully independent and able to run in any order. Sharing variables across tests is an
anti-pattern. `before`/`after` hooks are acceptable only for expensive, non-observable
infrastructure setup (e.g. starting a server or database connection) that has no bearing on the
assertions.

## Assertions

Prefer targeted assertions. Use `toMatchObject` rather than asserting every property. Multiple
assertions are fine when they all verify the same behaviour. Avoid asserting call counts when
asserting call arguments already covers the behaviour.

## Mocking

Mock as little as possible. A useful mental model: mock what is **above** the module under test in
the dependency tree, not below it. For unit tests the boundary is the module's public interface.
For integration tests, mock only genuine external systems. For e2e, mock almost nothing.

## Structure and Readability

Use a `describe` block per module or function; use `it` per behaviour. Name tests
descriptively — the name should communicate what the system does, not how.

Tests should read like a story. Include all the context needed to understand the test but no more —
no extraneous setup, no noise. The relationship between setup, action, and assertion should be
self-evident. For e2e tests in particular, use enough abstraction that the sequence of events is
clear enough to follow from the `it` description alone.

## Maintenance

- Treat test code like production code: keep it readable, lint it, refactor it. It can be WETter
  than production code when DRY-ing would obscure intent.
- Non-deterministic (flaky) tests must be fixed or deleted. No exceptions.
- Never skip a failing test. A failing test means behaviour broke — don't paper over it.
- Types and linting already provide guarantees. Don't duplicate them with executable assertions.
- Be strict with types in test code. No `any`, no unsafe casts, no cutting corners. Test code is
  production code in this regard.
