---
name: tdd
description: Test-driven development with red-green-refactor loop. Use when building features or fixing bugs — or when you mention "red-green-refactor", want "test-first development", or need "tracer bullet" implementation.
---

# Test-Driven Development

## When to use

- Building features or fixing bugs where correctness matters.
- Asked for "test-first", "TDD", "red-green-refactor", or "tracer bullets".
- Designing complex logic where fast feedback on correctness is valuable.

## When NOT to use

- Prototyping, throwaway code, or exploratory spikes where speed of discovery matters more than correctness.
- Changes so trivial that tests would duplicate type or lint coverage (rename, pure data shuffle).
- When the test-to-implementation ratio would be absurdly high — a one-line change requiring extensive test setup.
- Testing documentation or skill files to prove content exists in markdown. Tests verify executable code, not prose. If you want to validate a SKILL.md structure, use a linter or schema check instead.

## Philosophy / rationale

- **Tests verify behaviour through public interfaces, not implementation details.** Code can change entirely; tests should not. A passing test should survive a refactor that preserves behaviour.
- **Vertical tracer bullets beat horizontal slice-and-pray.** One test → one implementation → repeat. Each test responds to what you learned from the previous cycle. Writing all tests first tests imagined behaviour, not actual behaviour.
- **RED means you have a specification.** GREEN means it works. REFACTOR means make it read well — run `style-code` to guide the refactoring shape. Each state has a purpose; do not skip or blur them.

## Workflow

### 1. Plan

Before writing any code:

- Confirm with the user what interface changes are needed.
- Confirm which behaviours to test and prioritise them.
- Design interfaces for testability.
- List the behaviours to test (not implementation steps).

You cannot test everything. Focus testing effort on critical paths and complex logic, not every possible edge case.

### 2. Tracer bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behaviour → test fails
GREEN: Write minimal code to pass → test passes
```

This is your tracer bullet — it proves the path works end-to-end.

### 3. Incremental loop

For each remaining behaviour:

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

Rules:
- One test at a time.
- Only enough code to pass the current test.
- Do not anticipate future tests.
- Keep tests focused on observable behaviour.

### 4. Refactor

After all tests pass, run `style-code` to guide the refactoring shape:

- Extract duplication.
- Deepen modules — move complexity behind simple interfaces.
- Apply SOLID principles where natural.
- Consider what the new code reveals about existing code.
- Run tests after each refactor step.

**Never refactor while RED.** Get to GREEN first.

## Red Flags

- **Horizontal slicing.** Writing all tests first, then all implementation. You end up testing imagined behaviour, commit to test structure before understanding the implementation, and produce tests that pass when behaviour breaks and fail when it is fine.
- **Refactoring while RED.** The safety net is not up yet. Get to GREEN before restructuring.
- **Anticipating future tests.** Writing code you do not need yet because a future test will require it. It nearly always guesses the wrong shape.
- **Testing implementation details.** Coupling tests to internal structure so they break when you rename a private function or restructure internals. Test the public interface.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I will write the tests after" | Tests written after code tend to test what the code does, not what it should do. You lose the specification benefit of TDD. |
| "TDD is slower" | TDD front-loads time but saves debugging time. Net neutral or faster for anything non-trivial. |
| "This is too simple for TDD" | The simplest changes often have the most hidden assumptions. TDD surfaces them early. |
| "I already know what the implementation looks like" | Then write the test first to prove it. If the test forces a different interface, the implementation was wrong. |

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| Test-writing conventions (assertions, mocking, structure) | `style-tests` |
| Code-level style and conventions | `style-code` |
| Domain terminology for test names and module boundaries | `ubiquitous-language` |

Reference docs bundled with this skill: `tests.md`, `mocking.md`, `deep-modules.md`, `interface-design.md`, `refactoring.md`.

## Examples

### Horizontal vs vertical slicing

| Horizontal (wrong) | Vertical (right) |
|---|---|
| Write test1, test2, test3, test4, test5 | Write test1 → impl1 |
| Then write impl1, impl2, impl3, impl4, impl5 | Then test2 → impl2 |
| Tests test imagined behaviour, not actual | Each test responds to what you just learned |

### Test that survives refactor vs one that does not

| Instead of… | Write… |
|---|---|
| Mocking an internal method and asserting it was called | Calling the public API and asserting on the result |
| Testing that a private helper returns an intermediate value | Testing that the public function returns the correct output |

## Phase-gate checklists

### Phase 1: Planning complete

- [ ] User approved the interface and prioritised behaviours
- [ ] Behaviours are listed in terms of observable outcomes, not implementation steps

### Phase 2: Tracer bullet done

- [ ] End-to-end path proven through the public API
- [ ] Test passes GREEN with minimal implementation

### Phase 3: Incremental loop complete

- [ ] All prioritised behaviours tested
- [ ] All tests GREEN

### Phase 4: Refactor complete

- [ ] Duplication extracted without changing behaviour
- [ ] All tests still GREEN after every refactor step

## Verification checklist

- [ ] Test describes behaviour, not implementation
- [ ] Test uses public interface only
- [ ] Test would survive internal refactor
- [ ] Code is minimal for this test
- [ ] No speculative features added
- [ ] Never refactored while RED
