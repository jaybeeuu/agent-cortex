// Shared test helper: an in-memory `bd` answering the calls the HITL queue and the boundary
// re-rank make, so the queue's ordering and the boundary's comparison can be driven from a graph
// a test writes down.
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
 * @property {string} [parent]       The bead that owns this one, as `bd children` reads it.
 * @property {string} [dueAt]        The `--due` moment, as bd writes it: a UTC ISO string.
 * @property {string} [deferUntil]   The `--defer` wake moment, in the same form.
 */

/**
 * A `bd` runner over an in-memory graph, plus the record of what it was asked to write. It
 * reproduces the shapes the queue and the boundary read: `list -l execution:hitl --json` with
 * closed beads already excluded (bd's default filter) and the `due_at` / `defer_until` fields bd
 * writes, `dep list <id> --direction up --json` naming the beads that depend on it,
 * `dep list <id> --direction down --json` naming the beads it waits on (its own `dependsOn`,
 * `relatesTo` and `parent` edges, each tagged with its type, as bd reports them), and
 * `children <id> --json`. A `note` call appends to `state.notes` instead of writing a tracker.
 * @param {GraphBead[]} beads
 * @returns {{ bd: (args: string[]) => Promise<string>, state: { notes: { id: string, text: string }[], calls: string[][] } }}
 */
export function fakeQueueBd(beads) {
  /**
   * One dependency record, read from the graph so its status is the status the graph gives it.
   * @param {string} id @param {string} type @returns {{ id: string, status: string, dependency_type: string }}
   */
  const edge = (id, type) => ({
    id,
    status: beads.find((bead) => bead.id === id)?.status ?? 'open',
    dependency_type: type,
  });
  /** @type {{ notes: { id: string, text: string }[], calls: string[][] }} */
  const state = { notes: [], calls: [] };
  const bd = async (/** @type {string[]} */ args) => {
    state.calls.push(args);
    if (args[0] === 'note') {
      state.notes.push({ id: args[1], text: args[2] ?? '' });
      return '';
    }
    if (args[0] === 'children') {
      return JSON.stringify(
        beads
          .filter((bead) => bead.parent === args[1])
          .map((bead) => ({
            id: bead.id,
            title: bead.title,
            status: bead.status ?? 'open',
            labels: bead.labels ?? [],
            parent: bead.parent,
          })),
      );
    }
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
            ...(bead.dueAt === undefined ? {} : { due_at: bead.dueAt }),
            ...(bead.deferUntil === undefined ? {} : { defer_until: bead.deferUntil }),
            ...(bead.rice === undefined ? {} : { metadata: { rice: bead.rice } }),
          })),
      );
    }
    if (args[0] === 'dep' && args[1] === 'list') {
      const id = args[2];
      // bd's default direction is `down`: the beads this one waits on.
      const at = args.indexOf('--direction');
      const direction = at === -1 ? 'down' : args[at + 1];
      if (direction === 'down') {
        const self = beads.find((bead) => bead.id === id);
        if (self === undefined) return JSON.stringify([]);
        return JSON.stringify([
          ...(self.dependsOn ?? []).map((blocker) => edge(blocker, 'blocks')),
          ...(self.relatesTo ?? []).map((related) => edge(related, 'related')),
          ...(self.parent === undefined ? [] : [edge(self.parent, 'parent-child')]),
        ]);
      }
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
  return { bd, state };
}

/**
 * The runner alone, for a caller that does not read what was written.
 * @param {GraphBead[]} beads
 * @returns {(args: string[]) => Promise<string>}
 */
export function fakeBd(beads) {
  return fakeQueueBd(beads).bd;
}

/**
 * A `bd` runner keyed by scope name, so one test can give each configured workspace its own
 * graph. The queue passes the scope with every call, so the same stub answers a workspace's
 * `bd list` from that workspace's beads and never from another's.
 * @param {Record<string, GraphBead[]>} graphs  Beads per scope name.
 * @returns {(args: string[], scope: { name: string }) => Promise<string>}
 */
export function fakeBdByScope(graphs) {
  /** @type {Map<string, (args: string[]) => Promise<string>>} */
  const runners = new Map(Object.entries(graphs).map(([name, beads]) => [name, fakeBd(beads)]));
  return async (args, scope) => {
    const runner = runners.get(scope.name);
    if (runner === undefined) throw new Error(`fake bd: no graph for scope "${scope.name}"`);
    return await runner(args);
  };
}
