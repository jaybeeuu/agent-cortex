---
"@jaybeeuu/agent-cortex": minor
---

Make clearing the context safe in the **guppi** agent: write memory first, then recover the theme
from the tracker.

guppi now requires a memory write before any clear — what was decided and why, what is open, and
what the next session needs — into both the bead trail (`bd note`) and `bd remember` under a
`--key` naming the theme. `bd remember` stores into the workspace's own tracker database, so the
memory is already project-scoped; the key is a theme slug, and re-storing under it updates the
memory in place rather than accumulating stale copies.

The recovery rule states the exact read sequence — `bd prime` for the memories, `bd children
<epic>` for the theme, `bd show` per child for the trail, `bd provenance log` for the refs — so a
fresh session reconstructs a theme's state without a transcript.

Both rules are written against **"a clear"**, not against a command name: `/clear` is named as
today's mechanism and the self-flushing clear as its intended replacement, so the rules survive the
mechanism changing. A clear with no memory write is stated as a defect the agent names rather than
performing silently.
