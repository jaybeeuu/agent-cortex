// Shared test helper: an in-memory `bd` answering the two calls the HITL queue makes,
// so the queue's ordering can be driven from a graph a test writes down.
//
// One definition serves both call styles: the test imports `fakeBd` and calls the queue
// in-process, and the CLI test writes a stub binary whose body imports this same module,
// so the argv the script issues is answered by the same logic the unit tests use. `bd` is
// a real external system whose database tests must never touch, and CI has no bd binary at
// all, so the graph is data rather than a tracker.
//
// Written async throughout — the repo's check-no-sync lint scans test/ including helpers.

/**
 * One bead in the in-memory graph.
 * @typedef {object} GraphBead
 * @property {string} id
 * @property {string} title
 * @property {string} [status]
 * @property {string[]} [labels]
 * @property {object} [rice]         The stored `rice` record.
 * @property {string[]} [dependsOn]  Beads this one waits on, by a `blocks` edge.
 * @property {string[]} [relatesTo]  Beads this one merely relates to.
 */

/**
 * A `bd` runner over an in-memory graph. It reproduces the shapes the queue reads:
 * `list -l execution:hitl --json` with closed beads already excluded (bd's default
 * filter), and `dep list <id> --direction up --json` naming the beads that depend on it.
 * @param {GraphBead[]} beads
 * @returns {(args: string[]) => Promise<string>}
 */
export function fakeBd(beads) {
  return async (args) => {
    if (args[0] === 'list') {
      return JSON.stringify(
        beads
          .filter((bead) => (bead.labels ?? []).includes('execution:hitl'))
          .filter((bead) => (bead.status ?? 'open') !== 'closed')
          .map((bead) => ({
            id: bead.id,
            title: bead.title,
            status: bead.status ?? 'open',
            labels: bead.labels ?? [],
            ...(bead.rice === undefined ? {} : { metadata: { rice: bead.rice } }),
          })),
      );
    }
    if (args[0] === 'dep' && args[1] === 'list') {
      const id = args[2];
      return JSON.stringify(
        beads.flatMap((bead) => [
          ...(bead.dependsOn ?? []).includes(id)
            ? [{ id: bead.id, status: bead.status ?? 'open', dependency_type: 'blocks' }]
            : [],
          ...(bead.relatesTo ?? []).includes(id)
            ? [{ id: bead.id, status: bead.status ?? 'open', dependency_type: 'related' }]
            : [],
        ]),
      );
    }
    throw new Error(`fake bd: unsupported call ${args.join(' ')}`);
  };
}
