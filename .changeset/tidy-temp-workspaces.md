---
"@jaybeeuu/agent-cortex": patch
---

Stop the test suite from leaking temp workspaces into `/tmp`. Each test file that
creates workspaces under the system temp dir now shares one temp root that a
file-level `after()` hook removes, so the removal happens whether the tests
passed, failed, or threw before reaching their own cleanup — previously a single
green run of `test/installer.test.mjs` left 21 workspaces behind (7.4 MB apparent,
13 MB on disk: each is a materialised plugin tree of skills, agents and hooks),
plus one from `test/cli.test.mjs`'s `install claude --output` case. Repeated runs
could fill a small tmpfs and make unrelated tests fail with ENOSPC. A regression
guard runs a deliberately failing test file and asserts the run leaves nothing
behind.
