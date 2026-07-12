---
name: style-tests
description: Defines this project's test-writing conventions: assertion strategy, mock discipline, and what to test. Use BEFORE writing or editing any test and when reviewing tests — consult it whenever you add or change test files rather than choosing an approach ad hoc. Also for a "test review", "mock strategy", or deciding "what to test".
---

# Test Style

## When to use

- Writing new tests, reviewing existing tests, or debugging a failing test suite.
- Deciding between unit, integration, or e2e for a given behaviour.
- Asked for a "test review", "what should I test", or "is this test well-written".

## When NOT to use

- The red-green-refactor development loop — use `tdd` instead.
- Code-level style and conventions — use `style-code`.

## Philosophy / rationale

- **Test behaviour, not implementation.** A passing test should survive a refactor that does not change observable behaviour. If a test fails after a refactor that preserved behaviour, the test was wrong.
- **Prefer sociable tests over mockery.** Favour integration tests over unit tests. Reserve unit tests for complex functional logic that benefits from tight isolation. Use e2e smoke tests to prove the system hangs together. This is the testing trophy, not the testing pyramid.
- **Every test has a cost.** Time to write, run, and maintain. Only write a test when its value exceeds its weight. Each behaviour should be covered at least once — ideally only once.

## Workflow

1. **Determine the test level.** Can you test this behaviour through the module's public API or interface? Prefer integration-level tests. Reserve unit tests for complex functional logic that genuinely benefits from tight isolation. Use a small number of e2e smoke tests to prove the system hangs together.

2. **Decide what to mock.** Mock as little as possible. A useful mental model: mock what is **above** the module under test in the dependency tree, not below it. At the integration level, mock only genuine external systems. At e2e, mock almost nothing.

3. **Write the test structure.** Use a `describe` block per module or function; use `it` per behaviour. Name tests descriptively — the name should communicate what the system does, not how. The relationship between setup, action, and assertion should be self-evident.

4. **Set up data.** Inline what matters — any value that is asserted on or establishes the test condition must appear inline in the test body. Use factory/builder helpers for complex objects with sensible defaults, but any value that changes the test condition must be an explicit override, never buried in a default. Avoid `before`/`after` hooks for shared state; they are acceptable only for expensive, non-observable infrastructure setup (e.g. starting a server or database).

5. **Write targeted assertions.** Prefer `toMatchObject` over asserting every property. Multiple assertions are fine when they all verify the same behaviour. Avoid asserting call counts when asserting call arguments already covers the behaviour.

6. **Review against the checklist below.** Read the test as if you are seeing the codebase for the first time.

## Red Flags

- **Mocking implementation details.** Hooking into internal module structure ties tests to code shape, not behaviour. Mock the module's public interface instead.
- **Duplicating type or lint coverage.** Types and linting already provide those guarantees. Repeating them with assertions adds maintenance cost for zero value.
- **Skipping flaky tests.** A flaky test is a broken test. Fix it or delete it. Skipping normalises unreliability across the suite.
- **Sharing state via hooks.** Tests must be fully independent. `before`/`after` hooks that set up shared mutable state create order-dependent failures.
- **`any` or unsafe casts in test code.** Test code is production code. Be strict with types — no `any`, no unsafe casts, no cutting corners.
- **Skipping a failing test.** A failing test means behaviour broke. Investigate and fix it — do not paper over it.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "It passed locally" | CI is the only truth. If a test is flaky, it is broken — fix or delete. |
| "I'll mock this to keep the test simple" | Over-mocking hides integration bugs. Mock the boundary, not the internals. |
| "I'll fix the flake later" | No you will not. Fix it now or delete it. |
| "This test is too small for that pattern" | Small tests benefit from structure too. Consistency beats shortcuts. |
| "I'll skip this failing test and come back" | A skipped test is a blind spot. The failure is telling you something — listen to it. |

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| Red-green-refactor development loop | `tdd` |
| Code-level style and conventions | `style-code` |
| Secrets and credential scanning | `review-security` |

## Examples

### Mock boundaries

| Instead of… | Write… |
|---|---|
| Mocking the internal database driver to verify a query was called | Testing through the repository interface with a test double at that boundary |
| Mocking `fetch` in a unit test for an API client | Testing the client with a real HTTP stub that returns controlled responses |

### Targeted assertions

| Instead of… | Write… |
|---|---|
| `expect(result).toEqual(fullExpectedObject)` with every field asserted | `expect(result).toMatchObject({ status: "success", id: expect.any(String) })` |
| `expect(mockSave).toHaveBeenCalledTimes(1)` and then `expect(mockSave).toHaveBeenCalledWith(data)` | Just the call-args assertion — count is redundant |

### Factory overrides

| Instead of… | Write… |
|---|---|
| `const user = createUser();` where the test needs `isAdmin: true` but the default happens to set it | `const user = createUser({ isAdmin: true });` — explicit override visible in the test body |

## Verification checklist

- [ ] Test verifies behaviour, not implementation structure
- [ ] No mocking of internal module details — only public interfaces
- [ ] No `before`/`after` hooks for shared test state (infrastructure setup only)
- [ ] Assertions are targeted — no over-asserting or redundant checks
- [ ] No skipped or commented-out tests
- [ ] No flaky tests — all deterministic
- [ ] No `any` or unsafe casts in test code
- [ ] No duplication of type or linting coverage
