---
"@jaybeeuu/agent-cortex": patch
---

Stop the test suite from leaking temp workspaces into `/tmp`. Each test file that
creates workspaces under the system temp dir now shares one temp root that a
file-level `after()` hook removes, so the removal happens whether the tests
passed, failed, or threw before reaching their own cleanup — previously a failing
run left one workspace (with a copied `node_modules` closure) behind per failed
test, which could fill a small tmpfs and make unrelated tests fail with ENOSPC.
A regression guard runs a deliberately failing test file and asserts the run
leaves nothing behind.
