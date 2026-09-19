import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveClassification, auditBeads, runCli } from '../skills/planning/classify-bead/scripts/classify-bead.mjs';

const testDir = dirname(fileURLToPath(import.meta.url));

describe('resolveClassification', () => {
  it('resolves AFK from an existing implementation-type:afk label', () => {
    const result = resolveClassification({
      labels: ['implementation-type:afk'],
      description: 'Do a thing.',
    });

    assert.equal(result.classification, 'afk');
    assert.equal(result.source, 'label');
    assert.equal(result.escalate, false);
  });

  it('resolves HITL from an existing implementation-type:hitl label', () => {
    const result = resolveClassification({
      labels: ['implementation-type:hitl'],
      description: 'Provision the staging cluster.',
    });

    assert.equal(result.classification, 'hitl');
    assert.equal(result.source, 'label');
    assert.equal(result.escalate, false);
  });

  it('prefers AFK when both implementation-type labels are present', () => {
    const result = resolveClassification({
      labels: ['implementation-type:hitl', 'implementation-type:afk'],
      description: 'Ambiguous bead.',
    });

    assert.equal(result.classification, 'afk');
  });

  it('resolves AFK from a legacy ## Type block when no label is present', () => {
    const result = resolveClassification({
      labels: [],
      description: 'Add the export API.\n\n## Type\n\nAFK\n\n## Design\n\nSomething.',
    });

    assert.equal(result.classification, 'afk');
    assert.equal(result.source, 'type-field');
    assert.equal(result.escalate, false);
  });

  it('resolves HITL from a case-insensitive ## type block', () => {
    const result = resolveClassification({
      labels: [],
      description: 'Rotate the signing key.\n\n## type\n\nhitl',
    });

    assert.equal(result.classification, 'hitl');
    assert.equal(result.source, 'type-field');
  });

  it('resolves an inline ## Type: AFK field', () => {
    const result = resolveClassification({
      labels: [],
      description: 'Tidy the logs.\n\n## Type: AFK\n',
    });

    assert.equal(result.classification, 'afk');
    assert.equal(result.source, 'type-field');
  });

  it('prefers the label over a conflicting ## Type field', () => {
    const result = resolveClassification({
      labels: ['implementation-type:afk'],
      description: 'Conflicting bead.\n\n## Type\n\nHITL',
    });

    assert.equal(result.classification, 'afk');
    assert.equal(result.source, 'label');
  });

  it('escalates when the ## Type field carries no AFK/HITL value', () => {
    const result = resolveClassification({
      labels: [],
      description: 'A feature.\n\n## Type\n\nFeature',
    });

    assert.equal(result.classification, null);
    assert.equal(result.escalate, true);
  });

  it('resolves AFK from explicit no-human phrasing', () => {
    const result = resolveClassification({
      labels: [],
      description: 'Rename the column; no human review required.',
    });

    assert.equal(result.classification, 'afk');
    assert.equal(result.source, 'heuristic');
  });

  it('resolves HITL from an explicit human sign-off requirement', () => {
    const result = resolveClassification({
      labels: [],
      description: 'Ship the redesign once it has stakeholder sign-off.',
    });

    assert.equal(result.classification, 'hitl');
    assert.equal(result.source, 'heuristic');
  });

  it('lets a HITL signal outrank a generic automated-tests signal', () => {
    const result = resolveClassification({
      labels: [],
      description: 'Has automated tests, but the release requires human approval.',
    });

    assert.equal(result.classification, 'hitl');
  });

  it('resolves AFK when the acceptance criteria are automated tests', () => {
    const result = resolveClassification({
      labels: [],
      description: 'Cover the parser with automated tests.',
    });

    assert.equal(result.classification, 'afk');
  });

  it('escalates when no deterministic signal is present', () => {
    const result = resolveClassification({
      labels: [],
      description: 'Rework the billing domain model to support proration.',
    });

    assert.equal(result.classification, null);
    assert.equal(result.source, null);
    assert.equal(result.escalate, true);
  });

  it('prefers the ## Type field over heuristic signals', () => {
    const result = resolveClassification({
      labels: [],
      description: '## Type\n\nHITL\n\nCover it with automated tests.',
    });

    assert.equal(result.classification, 'hitl');
    assert.equal(result.source, 'type-field');
  });
});

describe('auditBeads', () => {
  const sample = [
    { labels: ['implementation-type:afk'], description: '' },
    { labels: ['implementation-type:hitl'], description: '' },
    { labels: [], description: '## Type\n\nAFK' },
    { labels: [], description: 'Rework the billing domain model.' },
  ];

  it('counts each resolution source and the deterministic share', () => {
    const summary = auditBeads(sample);

    assert.deepEqual(summary.bySource, { label: 2, typeField: 1, heuristic: 0, rubric: 1 });
    assert.equal(summary.deterministic, 3);
    assert.equal(summary.needsRubric, 1);
    assert.equal(summary.deterministicRatio, 0.75);
  });

  it('reports a zero ratio for an empty sample', () => {
    assert.equal(auditBeads([]).deterministicRatio, 0);
  });
});

describe('runCli', () => {
  function makeExec(beads) {
    const calls = [];
    const exec = async (args) => {
      calls.push(args);
      if (args[0] === 'show') return JSON.stringify(beads);
      if (args[0] === 'list') return JSON.stringify(beads);
      if (args[0] === 'tag') return '';
      throw new Error(`unexpected bd call: ${args.join(' ')}`);
    };
    return { exec, calls };
  }

  function capture() {
    let output = '';
    return { write: (chunk) => { output += chunk; }, read: () => JSON.parse(output) };
  }

  it('applies the label when the ## Type field resolves the classification', async () => {
    const { exec, calls } = makeExec([{ id: 'proj-1', labels: [], description: '## Type\n\nAFK' }]);
    const out = capture();

    const code = await runCli({ argv: ['proj-1'], exec, write: out.write });

    assert.equal(code, 0);
    assert.deepEqual(calls, [
      ['show', 'proj-1', '--json'],
      ['tag', 'proj-1', 'implementation-type:afk'],
    ]);
    assert.deepEqual(out.read(), {
      id: 'proj-1',
      classification: 'afk',
      source: 'type-field',
      reason: 'legacy ## Type field declares AFK',
      escalate: false,
      applied: true,
      label: 'implementation-type:afk',
    });
  });

  it('does not re-apply a label that is already present', async () => {
    const { exec, calls } = makeExec([{ id: 'proj-2', labels: ['implementation-type:hitl'], description: '' }]);
    const out = capture();

    const code = await runCli({ argv: ['proj-2'], exec, write: out.write });

    assert.equal(code, 0);
    assert.deepEqual(calls, [['show', 'proj-2', '--json']]);
    assert.equal(out.read().applied, false);
    assert.equal(out.read().classification, 'hitl');
  });

  it('escalates without applying a label when no deterministic signal is present', async () => {
    const { exec, calls } = makeExec([{ id: 'proj-3', labels: [], description: 'Rework the billing model.' }]);
    const out = capture();

    const code = await runCli({ argv: ['proj-3'], exec, write: out.write });

    assert.equal(code, 0);
    assert.deepEqual(calls, [['show', 'proj-3', '--json']]);
    assert.equal(out.read().escalate, true);
    assert.equal(out.read().label, null);
  });

  it('resolves without applying a label under --dry-run', async () => {
    const { exec, calls } = makeExec([{ id: 'proj-4', labels: [], description: '## Type\n\nHITL' }]);
    const out = capture();

    const code = await runCli({ argv: ['proj-4', '--dry-run'], exec, write: out.write });

    assert.equal(code, 0);
    assert.deepEqual(calls, [['show', 'proj-4', '--json']]);
    assert.equal(out.read().classification, 'hitl');
    assert.equal(out.read().applied, false);
  });

  it('reports the deterministic split in --audit mode', async () => {
    const beads = [
      { labels: ['implementation-type:afk'], description: '' },
      { labels: [], description: 'Rework the billing model.' },
    ];
    const { exec, calls } = makeExec(beads);
    const out = capture();

    const code = await runCli({ argv: ['--audit', '--limit', '2'], exec, write: out.write });

    assert.equal(code, 0);
    assert.deepEqual(calls, [['list', '--all', '--json', '--limit', '2', '--sort', 'created']]);
    assert.equal(out.read().deterministic, 1);
    assert.equal(out.read().needsRubric, 1);
  });
});

describe('classifier wiring', () => {
  it('exposes the classifier at the sibling path callers are told to use', async () => {
    // create-task/SKILL.md resolves <skill-scripts>/../../classify-bead/scripts/classify-bead.mjs.
    const createTaskScripts = resolve(testDir, '../skills/planning/create-task/scripts');
    const classifier = resolve(createTaskScripts, '../../classify-bead/scripts/classify-bead.mjs');

    await assert.doesNotReject(access(classifier));
  });
});
