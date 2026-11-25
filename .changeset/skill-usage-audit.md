---
"@jaybeeuu/agent-cortex": patch
---

`docs/research/skill-usage-audit.md` records the skill-usage findings that until now lived only in
a tracker bead: monthly sessions, skill reads, distinct skills and reads per session from June to
mid-November 2026, the weekly peaks, and the caveats on the method. The scan behind them covered
668 session transcripts and 231 MB, and it cannot be repeated on demand.

The note is the baseline for the period before the daily rollups shipped. Those rollups — one
record per skill per day, retained 365 days — now answer a trend question directly, but they hold
no history from before their install, by design. Nothing in the shipped package changes: the note
is repository documentation, not an install asset, and `docs/inspirations.md` lists it beside the
other internal research notes.

It also records the decision the audit asked for. Bounded daily rollups plus a `timeline` view were
chosen and landed under `agnt-ctx-rhzo`; a shipped transcript-scan script and a hot/cold pruning
split were not taken, and the note states why.
