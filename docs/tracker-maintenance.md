# Tracker maintenance

`bd`'s Dolt store grows with **commit history**, not with the amount of data you track. This
checkout reached 10,563 commits for 1,071 beads (512 KB of JSONL) and 811 MB of Dolt data; every
command then took 2–3 s, because each invocation opens the whole history.

This is an occasional operator task. **No agent is required to maintain the store**: do not
squash it at the end of a task, and no pipeline stage depends on it. The store is fine until
calls get slow, and then one person fixes it once.

Measured on this checkout, 2026-11-24:

| | before | after squash |
|---|---|---|
| Dolt data (`noms`) | 811 MB | 8.9 MB |
| commit count | 10,563 | 1 |
| `bd ready` | 1928 ms | 39 ms |
| `bd list` | 2209 ms | 38 ms |

The **data** is `noms`; that is the figure to compare across a squash. bd also reports a larger
"Store" size — `.dolt` is 127 MB here — because the directory carries `git-remote-cache`
(118 MB), a bare clone of the project git repo kept for the `git+https://` Dolt remote. Flatten
does not shrink that cache, so a store total barely moves while the data falls by two orders of
magnitude.

Treat those numbers as a sample, not a target. The rule below is what generalises.

## The rule

Squash the history, **then** publish the squashed history. In that order, every time:

```bash
bd flatten --force          # all history -> 1 commit (irreversible locally)
# or: bd compact --days 30 --force   # keep the last 30 days, squash older
bd dolt push --force
```

`bd flatten` rewrites the local branch. The Dolt remote still carries the old chain until you
push, so any later `bd dolt pull` merges it straight back.

## Why the order matters

`bd dolt push --force` moves the remote ref (`refs/dolt/data`) to whatever your local history
currently is — including a bloated one. Pushing after a pull therefore *republishes* the
history you just squashed away, and the next pull restores it again. The `--force` flag works
fine; it faithfully copies the wrong state if you run it at the wrong time.

The trap fires on its own: a session that pulls before its first command, or a pipeline stage
that syncs at the end of a run, is enough.

## Verify

Three checks, all fast:

```bash
bd compact --dry-run | sed -n '3p'                  # a small commit count, not thousands
bd dolt pull                                        # must not grow that count
du -sh .beads/embeddeddolt/agent_nexus/.dolt/noms   # ~9 MB when squashed```

If `bd dolt pull` grows the count, the remote was not rewritten — go back to the rule and push
the squashed state.

## Do not

- **Delete `.dolt/git-remote-cache` to save disk.** It is a bare clone of the project git repo
  (118 MB here), the local end of the `git+https://` Dolt remote. Removing it forces a full
  re-fetch: the next command restores the old Dolt chain (measured: 8.7 MB of data back to
  205 MB within minutes) and the cache is rebuilt at the same size, so the disk comes back
  anyway. It costs disk, not latency; removing it changed call time by noise only.
- **Delete individual `.darc` files in `.beads/backup`.** It is one rolling chunked backup — a
  `manifest` listing the chunks — not a set of independent snapshots. Deleting a chunk corrupts
  it. To reclaim space, point a fresh destination at it with `bd backup init <path>` and sync.
- **Run `bd dolt pull` while the remote still carries old history.** Check the commit count
  first.

## When to run

- `bd compact --dry-run` reports a commit count in the thousands.
- `bd ready`, `bd list` or `bd show` take longer than a second on an idle machine.
- After any pull that restores old history.

`dolt.auto-commit: on` creates one Dolt commit per write, so the count climbs steadily under
normal use. The count is the signal; the data size is not.
