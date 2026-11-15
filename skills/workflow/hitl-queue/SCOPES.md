# Scopes

The scope list says which bd workspaces the queue reads, and which one it may write. It is a
**file**, never code: a path in a script would name one person's machine, and a scope list does
not.

## The file

| Item | Value |
|---|---|
| Default | `.agent-cortex/scopes.json`, relative to the repository root |
| User level | `<AGENT_CORTEX_HOME>/scopes.json`, then `~/.agent-cortex/scopes.json` |
| Override | `--scopes <path>` |
| Fallback | no file found: one scope, named `code`, for the current workspace, writable |

The project list is read first, so a repository can commit the scopes its work spans. The user
list is the personal one: it travels with the person, not the checkout. With neither, the queue
behaves as it did before scopes existed — one workspace, one list.

```json
{
  "scopes": [
    { "name": "code", "path": ".", "kind": "code", "readOnly": false },
    { "name": "notes", "path": "~/personal", "kind": "personal", "readOnly": true },
    { "name": "ops", "path": "../ops", "kind": "ops" }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The tag every row from this scope carries. Unique within the file. |
| `path` | yes | The workspace. `~` is the home directory; a relative path resolves against the repository root of the list itself, never the directory the run started in. The queue reports the resolved absolute path, never the text this field holds. |
| `kind` | no | `code`, `personal` or `ops`. Default `code`. A `personal` scope is the one a shared invocation withholds. |
| `readOnly` | no | Default `true`. A scope you did not mark writable is read-only. |

## One writable scope

The **current workspace** — the nearest ancestor of the run's directory that carries its own
`.beads` — is the only scope a command may write to. A scope is writable only when it is not
marked read-only *and* its resolved path is that workspace, so a list copied onto another machine
cannot widen the writable set: the same entry that is writable in your checkout is read-only in
mine.

The queue writes nothing today — its tracker calls are `bd list` and `bd dep list`. The rule is
enforced anyway, at the one function every tracker call for a scope passes through, so a later
change cannot quietly write to the wrong workspace:

```js
guardRunner(scope, bd)          // refuses any call that is not one of the two reads
```

## Availability

A scope is read only when it can be:

- **the directory exists**, and
- **it carries its own `.beads`**, because bd resolves a workspace by walking *up* from the
  current directory. A configured directory with no tracker of its own would otherwise read the
  enclosing workspace's beads and tag them with the wrong scope, which is a privacy failure and a
  correctness one.

Anything else is reported `unavailable` with the reason, above the list, and skipped. A `bd` call
that fails marks its own scope unavailable and leaves the others alone, so one broken workspace
never costs the whole queue. Exit code stays `0`.

## The daily scope note

Above the ranked list the queue prints one line: which scopes the day belongs to, and the
strategy line that says so.

```
today · personal, code — "daily: personal, code — Monday and Tuesday are the personal objectives" (strategy v3, "## Current themes", scope notes)
```

The line is read from the **personal scope's** own strategy, at the documented default path
inside that workspace, so the note is personal strategy text and never a copy of it. Write it as
one bullet under `## Current themes`:

```markdown
- daily: personal, code — Monday and Tuesday are the personal objectives
```

The scope names before the em dash are what the note leads with; the rest is the reason, quoted
verbatim. The citation names the strategy version, the section the line sat under, and the scope
it was read from. When no personal scope is configured, or none carries a `daily:` line, the note
says that and names what to add — it never invents one.

## The privacy boundary

- **A read-only scope receives no write.** Enforced by `guardRunner`, tested with a mutation.
- **A shared invocation reads no personal scope at all.** `--shared`, or
  `AGENT_CORTEX_QUEUE_SHARED=1`, marks output that will leave this machine — a CI log, a pasted
  report, a handoff to another agent. Personal scopes are then `withheld`: not read, not ranked,
  not quoted, and counted in the header so nothing disappears silently. **A withheld scope
  publishes neither its name nor its path**, because both identify a workspace the reader may not
  see: the header prints the count, and `--json` prints `null` for both fields.
- **A withheld scope publishes no `name` and no `path`.** Both identify the workspace the reader
  may not see — a path encodes the home directory, and a name is whatever the owner called it —
  so `--json` carries `null` for both. `kind`, `readOnly` and `writable` remain, because the
  header already says a personal scope was withheld.
- **A personal row appears only in a local invocation.** Local is the default, because the person
  reading their own queue on their own machine is the common case.
- **Nothing personal is written anywhere.** The queue copies no bead text into another workspace
  because it writes no bead at all, and the daily line is quoted, never re-filed.

## Reading the queue

```bash
node <skill-scripts>/queue.mjs queue                     # every configured scope
node <skill-scripts>/queue.mjs queue --scopes ./list.json
node <skill-scripts>/queue.mjs queue --shared             # output that leaves this machine
node <skill-scripts>/queue.mjs queue --json                # scope statuses and the note, structured
```

`--json` carries the same answer with every derived field: each scope's `status`, `reason`,
`readOnly` and `writable`, the daily note, and the withheld counts. A withheld scope has `null`
for `name` and `path`.
