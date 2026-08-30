# Reference — run-pipeline-stage

Rarely-needed detail for the `run-pipeline-stage` skill. The main workflow lives in
`SKILL.md`; this file covers maintenance of its scripts package only.

## Scripts package maintenance

The scripts package (`skills/workflow/run-pipeline-stage/scripts`, a private workspace
package `@agent-cortex/run-pipeline-stage-scripts`) backs the progress-doc generator used
in `SKILL.md` step 6.

Typecheck and test it with:

```bash
pnpm --prefix skills/workflow/run-pipeline-stage/scripts typecheck
pnpm --prefix skills/workflow/run-pipeline-stage/scripts test
```

### Data-fetch / renderer split

The data-fetch layer (`parseBdList` / `parseBdShow`) is kept separate from the renderer
so the `bd` output format can be swapped without re-fetching.