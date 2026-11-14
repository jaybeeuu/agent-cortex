# Score Bead — Record, Bands and Trail

The exact shapes `rice.mjs` reads and writes. Read this when a record looks wrong, when you need the band thresholds, or when you are auditing a re-score.

## The metadata record

One key, `rice`, written with `bd update <id> --metadata '{"rice":{…}}'`. `bd show` renders it under `METADATA`:

```
METADATA
  rice: {"assessedAt":"2026-11-14T09:00:00.000Z","confidence":0.7,"effort":2,
         "impact":3,"rationale":"unblocks the messaging epic — Current themes",
         "reach":4,"score":4.2,"strategyVersion":2}
```

| Field | Type | Meaning |
|---|---|---|
| `reach` | number ≥ 0 | How much work the bead changes |
| `impact` | number ≥ 0 | How much each unit of reach gains, on the rubric's scale |
| `confidence` | number `0..1` | Probability that the reach, impact and effort estimates hold |
| `effort` | number > 0 | Cost, on the rubric's effort calibration |
| `score` | number, one decimal | `reach × impact × confidence ÷ effort` |
| `strategyVersion` | integer | The strategy file's own version, read after it validated |
| `assessedAt` | RFC 3339 string | When the judgement was made, UTC |
| `rationale` | string | Why these numbers, then the `[prior]` trail |

The total is rounded once, at the end: `Math.round(value * 10) / 10`. Rounding a component instead would make the stored components disagree with the stored total.

`score` refuses, writing nothing, when:

- the strategy file is missing, or `validate` rejects it (the reason is printed);
- a component is not a number, `confidence` falls outside `0..1`, or `effort` is zero or less;
- the rationale is empty.

A refusal exits 1 with the reason, and exits 2 for a malformed call. Neither reaches the tracker: the strategy is read and validated before the first `bd` call, so a refused score leaves no metadata, no note and no tag behind.

## The band table

| Score at least | Proposed priority |
|---|---|
| 8 | P1 |
| 4 | P2 |
| 1 | P3 |
| 0 | P4 |

Bands are highest-first and evaluated in order. P0 is absent and `bandFor` throws if a table ever yields it, so a computed score can never file a bead as an incident. The table lives in `rice.mjs` as `DEFAULT_BANDS`; changing it is a code change, reviewable like any other.

`band <id>` prints the proposal and the command that would apply it:

```
✓ tst-6: score 4.2 → P2 (currently P3)
  proposal only — review the components and the rationale, then apply: bd update tst-6 -p 2
```

It reads the bead with `bd show` and calls nothing else. A bead already at P0 is refused before a proposal exists, because an incident is not re-prioritised by a rubric.

## The rationale trail

The rationale holds the current argument, then one `[prior]` line per score it replaced, oldest first and ending with the score just replaced:

```
re-scored against the December rubric
[prior] score 1 @ strategy v1, assessed 2026-10-01T00:00:00.000Z (reach 1, impact 1, confidence 0.5, effort 2)
[prior] score 4.2 @ strategy v2, assessed 2026-11-14T09:00:00.000Z (reach 4, impact 3, confidence 0.7, effort 2)
```

Each line carries the superseded total, its components, the strategy version it was judged against and its date, so the old arithmetic stays checkable after the components are overwritten.

Why the rationale and not a separate `history` array: the bead carries one record, `bd show` renders it in one place, and a re-score cannot drop the history by forgetting a second store. A reader greps `[prior]` to separate the trail from the prose. A record with no numeric `score` contributes no new line, but its existing trail is carried forward unchanged.
