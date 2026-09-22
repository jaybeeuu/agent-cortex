---
name: style-tests
description: Defines this project's test-writing conventions — what to test, assertion strategy, mock discipline, the ban on static-content assertions, and how to construct test data. Use BEFORE writing or editing any test and when reviewing tests — consult it whenever you add or change test files rather than choosing an approach ad hoc. Also for a "test review", "mock strategy", "what should I test", or "is this test well-written".
---

# Test Style

## When to use

- Writing new tests, reviewing existing tests, or debugging a failing test suite.
- Deciding between unit, integration, or e2e for a given behaviour.
- Deciding what test data to build and where.
- Asked for a "test review", "what should I test", or "is this test well-written".

## When NOT to use

- The red-green-refactor development loop — use `tdd` instead.
- Code-level style and conventions — use `style-code`.

## Principles

- **Test behaviour, not implementation.** A test must survive a refactor that does not change observable behaviour. If it fails after such a refactor, the test was wrong.
- **Mock last, at the edges.** Mock genuine external boundaries only. Never mock within the application/domain boundary; a real collaborator is almost always cheaper than a mock that lies.
- **Unit tests at module boundaries.** Exercise the surface of a deep module through its public API, never its internals.
- **Integration and e2e are realistic.** Exercise real service behaviour — AWS via LocalStack or TestContainers. AWS may not be the AUT, but it must still be exercised for certainty. Use a small number of smoke tests to prove the system hangs together.
- **No more tests than needed.** Every test earns its cost by pinpointing exactly where a failure lies. A test that cannot localise a fault adds maintenance weight without signal.
- **Test code is production code.** Linted, typechecked, properly typed — no `any`, no unsafe casts, no shortcuts in constructing data. Tolerate WETness where it leaves tests more descriptive.
- **All setup and assertion data is visible inline.** Show exactly and only the values that explain the case; a helper with sensible defaults keeps it terse.
- **Deterministic and performant.** A failing or flaky test is investigated now. Deferring is acceptable only against a top-priority bead.
- **Balanced test trophy.** Unit tests support the integration tests that carry the higher coverage — not a pyramid base.
- **Tests are independent.** No shared mutable state, no order dependence; each test passes in isolation and in any order.
- **CI is the only truth.** Locally green never counts.
- **Don't re-test types or lint.** The compiler and linter already guarantee those; repeating them adds cost for no value.
- **Testing is not optional.** Every behaviour is tested.
- **Spec-by-test.** A behaviour is done when its test row is green — the plan's test rows are the spec that gates AFK implementation.

## Content-assertion ban

**No test may assert the static contents of a file** — config, markdown, terraform, or any
snapshot of static content. Comparing a file against an expected string is a content inventory,
not behaviour proof; such a test belongs to neither the suite nor the PR.

Instead, assert the behaviour the file participates in: that key data was inserted into a
template, that a compiler converted a header correctly, or run a smoke test proving deployed
services are up and ready to serve traffic.

The line is **whether the assertion proves the behaviour under test**, not whether a file is
read. A parser's golden-output test — where the expected output is a product of the behaviour —
is legitimate. `readFile(config).includes("x")` is not.

## Test-data construction

- **Build data inline in the test** (or in a helper called from it) so the test body shows the shape of its own input.
- **No shared mutable top-level fixture.** If data must be reused, produce it fresh per test via a function — a factory, not a constant. Module-scope constants are acceptable only when genuinely immutable and read-only.
- **Prefer a small configurable helper** — a factory taking partial overrides with defaults for the rest — over repeated full literals. Build the helper only when reuse justifies it; a single test's data stays a plain inline object.
- **Name and locate the helper conventionally** so the next agent finds it — colocated with the tests, named for what it builds.

## Workflow

1. **Determine the test level.** Can you test this behaviour through the module's public API or interface? Prefer integration-level tests (the trophy's higher coverage). Reserve unit tests for complex functional logic that genuinely benefits from tight isolation, always at the module boundary. Use a small number of e2e smoke tests — with real services via LocalStack/TestContainers — to prove the system hangs together.

2. **Decide what to mock.** Mock as little as possible, and only at genuine external boundaries. A useful mental model: mock what is **above** the module under test in the dependency tree, not below it. At e2e, mock almost nothing.

3. **Write the test structure.** Use a `describe` block per module or function; use `it` per behaviour. Name tests descriptively — the name should communicate what the system does, not how. The relationship between setup, action, and assertion should be self-evident.

4. **Set up data.** Inline what matters — any value that is asserted on or establishes the test condition must appear inline in the test body. Reuse via a small configurable factory (partial overrides, sensible defaults) colocated with the tests and named for what it builds — never a shared mutable top-level fixture. Avoid `before`/`after` hooks for shared state; they are acceptable only for expensive, non-observable infrastructure setup (e.g. starting a server or database).

5. **Write targeted assertions.** Prefer `toMatchObject` over asserting every property. Multiple assertions are fine when they all verify the same behaviour. Avoid asserting call counts when asserting call arguments already covers the behaviour. Assert behaviour the file participates in, never its static contents.

6. **Review against the checklist below.** Read the test as if you are seeing the codebase for the first time.

## Red Flags

| Red flag | Instead |
|---|---|
| Asserting static file content — an expected config/markdown/terraform string, or a snapshot of static content | Assert the behaviour the file participates in: data inserted into a template, a header compiled correctly, a deployed service ready to serve traffic |
| Shared mutable top-level fixture reused across tests | Build fresh data per test via a factory; a module-scope constant only when genuinely immutable and read-only |
| Repeated full literals for the same shape | A small configurable helper taking partial overrides with sensible defaults |
| Mocking implementation details or internal module structure | Mock the genuine external boundary and test through the public interface |
| Duplicating type or lint coverage | Delete the assertion — the compiler and linter already guarantee it |
| Skipping flaky or failing tests | Fix or delete; a skipped test is a blind spot |
| Sharing state via `before`/`after` hooks | Independent tests; hooks only for expensive, non-observable infrastructure |
| `any` or unsafe casts in test code | Proper types — test code is production code |

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "It passed locally" | CI is the only truth. If a test is flaky, it is broken — fix or delete. |
| "I'll mock this to keep the test simple" | Over-mocking hides integration bugs. Mock the boundary, not the internals. |
| "I'll fix the flake later" | No you will not. Fix it now or delete it. |
| "This test is too small for that pattern" | Small tests benefit from structure too. Consistency beats shortcuts. |
| "I'll skip this failing test and come back" | A skipped test is a blind spot. The failure is telling you something — listen to it. |
| "The config file must match exactly this content" | You are cataloguing a file, not proving behaviour. Assert what the code does with it. |
| "A shared fixture saves setup time" | It couples tests and hides which value drives the case. Build data fresh per test. |

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| Red-green-refactor development loop | `tdd` |
| Code-level style and conventions | `style-code` |
| Plan test rows that gate implementation | `plan` |
| Secrets and credential scanning | `review-security` |

## Examples

### Behaviour over content

| Instead of… | Write… |
|---|---|
| Reading a generated config and asserting it equals an expected string | Assert the value the code inserted into the template |
| Snapshotting a markdown or terraform file's contents | Assert the behaviour the renderer/compiler produced |
| Asserting a deploy artefact's static bytes | A smoke test that the deployed service is up and ready to serve traffic |

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

### Test data

| Instead of… | Write… |
|---|---|
| `const user = sharedUser; user.isAdmin = true;` mutating a module-scope fixture | `const user = createUser({ isAdmin: true });` — fresh per test |
| Spelling the full object literal in every test | `createUser({ isAdmin: true })` — a helper with defaults and explicit overrides |

## Verification checklist

- [ ] Test verifies behaviour, not implementation structure
- [ ] No mocking of internal module details — only public interfaces
- [ ] No `before`/`after` hooks for shared test state (infrastructure setup only)
- [ ] Assertions are targeted — no over-asserting or redundant checks
- [ ] No test asserts static file content (config, markdown, terraform, static snapshots) — assertions prove behaviour, not inventory
- [ ] Test data is built inline or via a fresh-per-test factory; no shared mutable top-level fixture
- [ ] Reused test data uses a small configurable helper rather than repeated full literals
- [ ] No skipped or commented-out tests
- [ ] No flaky tests — all deterministic
- [ ] No `any` or unsafe casts in test code
- [ ] No duplication of type or linting coverage
