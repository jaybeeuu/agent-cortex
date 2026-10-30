import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EPIC_GATE_LABEL,
  FEATURE_GATE_LABEL,
  HITL_GATE_LABELS,
  fetchGateState,
  resolveGateState,
  runCli,
} from '../skills/workflow/ralph/scripts/pending-gates.mjs';

function createBead({ id, title = `${id} title` }) {
  return { id, title };
}

/**
 * Fake `bd` for the query-contract tests: answers the three queries ralph makes
 * and refuses anything else, so an unexpected query fails loudly.
 */
function makeExec({ ready = [], open = [], epics = [] } = {}) {
  const calls = [];

  const exec = async (args) => {
    calls.push(args);
    if (args[0] === 'ready') return JSON.stringify(ready);
    if (args[0] === 'list' && args.includes(EPIC_GATE_LABEL)) return JSON.stringify(epics);
    if (args[0] === 'list') return JSON.stringify(open);
    throw new Error(`unexpected bd call: ${args.join(' ')}`);
  };

  return { exec, calls };
}

function capture() {
  let output = '';
  return { write: (chunk) => { output += chunk; }, read: () => JSON.parse(output) };
}

describe('resolveGateState', () => {
  it('leaves dispatch unblocked while every gate is still parked behind its own pipeline', () => {
    const state = resolveGateState({
      readyGates: [],
      openGates: [
        createBead({ id: 'proj-1.5' }),
        createBead({ id: 'proj-2.5' }),
        createBead({ id: 'proj-3.5' }),
        createBead({ id: 'proj-4.5' }),
      ],
      epicsAwaitingMerge: [],
    });

    assert.deepEqual(state.pendingHumanAction, []);
    assert.deepEqual(state.parked, [
      { id: 'proj-1.5', title: 'proj-1.5 title' },
      { id: 'proj-2.5', title: 'proj-2.5 title' },
      { id: 'proj-3.5', title: 'proj-3.5 title' },
      { id: 'proj-4.5', title: 'proj-4.5 title' },
    ]);
  });

  it('reports an unblocked gate as pending human action', () => {
    const state = resolveGateState({
      readyGates: [createBead({ id: 'proj-1.5', title: 'PR Review and Merge' })],
      openGates: [createBead({ id: 'proj-1.5', title: 'PR Review and Merge' })],
      epicsAwaitingMerge: [],
    });

    assert.deepEqual(state.pendingHumanAction, [
      { id: 'proj-1.5', title: 'PR Review and Merge', kind: 'feature-pr' },
    ]);
    assert.deepEqual(state.parked, []);
  });

  it('separates an unblocked gate from gates that are still parked', () => {
    const state = resolveGateState({
      readyGates: [createBead({ id: 'proj-1.5' })],
      openGates: [createBead({ id: 'proj-1.5' }), createBead({ id: 'proj-2.5' })],
      epicsAwaitingMerge: [],
    });

    assert.deepEqual(state.pendingHumanAction.map((gate) => gate.id), ['proj-1.5']);
    assert.deepEqual(state.parked.map((gate) => gate.id), ['proj-2.5']);
  });

  it('reports an epic awaiting merge as pending human action alongside feature gates', () => {
    const state = resolveGateState({
      readyGates: [],
      openGates: [],
      epicsAwaitingMerge: [createBead({ id: 'epic-9', title: 'Merge epic into main' })],
    });

    assert.deepEqual(state.pendingHumanAction, [
      { id: 'epic-9', title: 'Merge epic into main', kind: 'epic-pr' },
    ]);
    assert.deepEqual(state.parked, []);
  });
});

describe('fetchGateState', () => {
  it('asks bd for unblocked gates, all gates, and epics awaiting merge on either HITL axis', async () => {
    const { exec, calls } = makeExec();

    await fetchGateState({ exec });

    assert.deepEqual(calls, [
      ['ready', '--json', '-l', FEATURE_GATE_LABEL, '--label-any', HITL_GATE_LABELS.join(',')],
      ['list', '--json', '--limit', '0', '-l', FEATURE_GATE_LABEL, '--label-any', HITL_GATE_LABELS.join(',')],
      ['list', '--json', '--limit', '0', '-l', EPIC_GATE_LABEL],
    ]);
  });

  it('covers both the current and the legacy HITL label axis', () => {
    assert.deepEqual(HITL_GATE_LABELS, ['execution:hitl', 'implementation-type:hitl']);
  });

  it('treats a gate that only the list query returns as parked', async () => {
    const { exec } = makeExec({ ready: [], open: [createBead({ id: 'proj-1.5' })] });

    const state = await fetchGateState({ exec });

    assert.deepEqual(state.pendingHumanAction, []);
    assert.deepEqual(state.parked, [{ id: 'proj-1.5', title: 'proj-1.5 title' }]);
  });
});

describe('pending-gates CLI', () => {
  it('prints the resolved gate state as JSON', async () => {
    const { exec } = makeExec({
      ready: [createBead({ id: 'proj-1.5' })],
      open: [createBead({ id: 'proj-1.5' }), createBead({ id: 'proj-2.5' })],
      epics: [createBead({ id: 'epic-9' })],
    });
    const out = capture();

    const code = await runCli({ argv: [], exec, write: out.write });

    assert.equal(code, 0);
    assert.deepEqual(out.read(), {
      pendingHumanAction: [
        { id: 'proj-1.5', title: 'proj-1.5 title', kind: 'feature-pr' },
        { id: 'epic-9', title: 'epic-9 title', kind: 'epic-pr' },
      ],
      parked: [{ id: 'proj-2.5', title: 'proj-2.5 title' }],
    });
  });
});
