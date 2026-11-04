---
"@jaybeeuu/agent-cortex": minor
---

`create-chores.mjs` is now idempotent: a re-run adopts the stage chores and PR gate that already exist under the parent, creates only what is missing, and skips deps that are already wired. Re-running it after a failed chore expansion is now the recovery path, so ralph no longer refuses to re-dispatch an expansion.
