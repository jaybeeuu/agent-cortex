---
"@jaybeeuu/agent-cortex": patch
---

Correct the type annotations the widened tooling typecheck surfaced. Measuring what a repo-wide
`checkJs` pass would report (the widening itself is tracked separately) turned up a handful of
genuine JSDoc defects rather than merely missing annotations, all fixed here with no runtime
change: `bin/installers/pi.mjs` referenced a `ManagedFileResult` type that was never defined, now
declared as a proper `@typedef` matching what `writeManagedJson` returns; five `async` functions
declared `@returns` without wrapping them in `Promise<…>`, so `tsc` rejected the declared type
(`installClaude`, `registerClaude`, `installCopilot`, `installPi`, `composeAgent`);
`runClaudeCommand`'s `new Promise()` needed a `Promise<void>` hint before `resolve()` could be
called without an argument; and the two shared predicates in `scripts/lib/fs.mjs` plus
`collect` in `scripts/check-no-sync.mjs` had untyped parameters and an inferred recursive return
type. Widening the typecheck to `bin/ lib/ hooks/ scripts/` reports 12 fewer errors afterwards.
