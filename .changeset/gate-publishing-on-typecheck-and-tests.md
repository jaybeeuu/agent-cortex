---
"@jaybeeuu/agent-cortex": patch
---

Gate publishing on typecheck and tests.

Nothing ships unless both pass: a new `verify` script (`pnpm typecheck && pnpm test`) is the
single definition of the gate, and two paths enforce it. `prepublishOnly` runs it for a
directory publish, and `publish-package` runs it before `pnpm pack`, because
`npm publish <tarball>` — the path changesets/action execs, and therefore the one every release
takes — runs no npm publish lifecycle hook at all. `pnpm pack` is untouched, so packing locally
is still fast.

`test/release-gates.test.mjs` proves it by executing those script bodies in a real shell against
a stub `pnpm`/`npm` pair: a failing typecheck or test aborts before the tarball is packed, and a
green pair reaches `npm publish` with the packed tarball.
