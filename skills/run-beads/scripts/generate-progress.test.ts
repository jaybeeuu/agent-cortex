import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseListLine,
  parseBdList,
  parseBdShow,
  buildStatusBadge,
  detectOrphanedBlocked,
  renderMermaidGraph,
  renderActiveWorkTable,
  renderCompletedSection,
  renderOrphanedBlockedCallout,
  renderMarkdown,
  fetchBeads,
  type Bead,
} from './generate-progress.ts';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: 'proj-abc',
    title: 'Do something',
    status: 'open',
    classification: 'afk',
    stage: null,
    epicId: null,
    blockedBy: [],
    blocks: [],
    descriptionSummary: 'Some summary',
    ...overrides,
  };
}

const BD_LIST_OUTPUT = `○ proj-aaa ● P1 First task
◐ proj-bbb ● P2 Second task
● proj-ccc ● P1 Third task
✓ proj-ddd ● P3 Completed task
❄ proj-eee ● P2 Deferred task

--------------------------------------------------------------------------------
Total: 5 issues (2 open, 1 in progress)

Status: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred`;

const BD_SHOW_AFK_CODING = `◐ proj-bbb · Second task   [● P2 · IN_PROGRESS]
Owner: Jane · Assignee: Jane · Type: task
Created: 2026-01-01 · Updated: 2026-01-02

DESCRIPTION
Implements the second task with some detail about what it does.
More detail here.

LABELS: implementation-type:afk, stage:coding

BLOCKS
  ← ○ proj-ccc: Third task ● P1

DEPENDS ON
  → ○ proj-aaa: First task ● P1`;

const BD_SHOW_HITL = `○ proj-aaa · First task   [● P1 · OPEN]
Owner: Jane · Type: task
Created: 2026-01-01 · Updated: 2026-01-01

DESCRIPTION
Configure secrets manually.

LABELS: implementation-type:hitl

`;

const BD_SHOW_NO_LABELS = `○ proj-ccc · Third task   [● P1 · BLOCKED]
Owner: Jane · Type: task
Created: 2026-01-01 · Updated: 2026-01-01

DESCRIPTION
Blocked task.

DEPENDS ON
  → ◐ proj-bbb: Second task ● P2`;

// ─── Behavior 1: parse bd list line ──────────────────────────────────────────

describe('parseListLine', () => {
  it('parses an open bead', () => {
    const result = parseListLine('○ proj-aaa ● P1 First task');
    assert.deepEqual(result, { id: 'proj-aaa', status: 'open', title: 'First task' });
  });

  it('parses an in-progress bead', () => {
    const result = parseListLine('◐ proj-bbb ● P2 Second task');
    assert.deepEqual(result, { id: 'proj-bbb', status: 'in_progress', title: 'Second task' });
  });

  it('parses a blocked bead', () => {
    const result = parseListLine('● proj-ccc ● P1 Third task');
    assert.deepEqual(result, { id: 'proj-ccc', status: 'blocked', title: 'Third task' });
  });

  it('parses a closed bead', () => {
    const result = parseListLine('✓ proj-ddd ● P3 Completed task');
    assert.deepEqual(result, { id: 'proj-ddd', status: 'closed', title: 'Completed task' });
  });

  it('parses a deferred bead', () => {
    const result = parseListLine('❄ proj-eee ● P2 Deferred task');
    assert.deepEqual(result, { id: 'proj-eee', status: 'deferred', title: 'Deferred task' });
  });

  it('returns null for separator/summary lines', () => {
    assert.equal(parseListLine('---'), null);
    assert.equal(parseListLine('Total: 5 issues'), null);
    assert.equal(parseListLine(''), null);
    assert.equal(parseListLine('Status: ○ open'), null);
  });

  it('handles leading whitespace', () => {
    const result = parseListLine('  ○ proj-aaa ● P1 First task');
    assert.deepEqual(result, { id: 'proj-aaa', status: 'open', title: 'First task' });
  });
});

// ─── Behavior 2: parse bd list output (multiple lines) ───────────────────────

describe('parseBdList', () => {
  it('extracts all bead entries from full bd list output', () => {
    const results = parseBdList(BD_LIST_OUTPUT);
    assert.equal(results.length, 5);
    assert.deepEqual(results[0], { id: 'proj-aaa', status: 'open', title: 'First task' });
    assert.deepEqual(results[1], { id: 'proj-bbb', status: 'in_progress', title: 'Second task' });
    assert.deepEqual(results[2], { id: 'proj-ccc', status: 'blocked', title: 'Third task' });
    assert.deepEqual(results[3], { id: 'proj-ddd', status: 'closed', title: 'Completed task' });
    assert.deepEqual(results[4], { id: 'proj-eee', status: 'deferred', title: 'Deferred task' });
  });

  it('returns empty array for empty output', () => {
    assert.deepEqual(parseBdList('No issues found.'), []);
  });
});

// ─── Behavior 3: parse bd show output ────────────────────────────────────────

describe('parseBdShow', () => {
  it('extracts afk classification and coding stage', () => {
    const result = parseBdShow(BD_SHOW_AFK_CODING);
    assert.equal(result.classification, 'afk');
    assert.equal(result.stage, 'coding');
  });

  it('extracts hitl classification', () => {
    const result = parseBdShow(BD_SHOW_HITL);
    assert.equal(result.classification, 'hitl');
    assert.equal(result.stage, null);
  });

  it('defaults to unknown classification when no label', () => {
    const result = parseBdShow(BD_SHOW_NO_LABELS);
    assert.equal(result.classification, 'unknown');
    assert.equal(result.stage, null);
  });

  it('extracts blocks list', () => {
    const result = parseBdShow(BD_SHOW_AFK_CODING);
    assert.deepEqual(result.blocks, ['proj-ccc']);
  });

  it('extracts blockedBy (depends on) list', () => {
    const result = parseBdShow(BD_SHOW_AFK_CODING);
    assert.deepEqual(result.blockedBy, ['proj-aaa']);
  });

  it('extracts blockedBy from show with only depends-on section', () => {
    const result = parseBdShow(BD_SHOW_NO_LABELS);
    assert.deepEqual(result.blockedBy, ['proj-bbb']);
    assert.deepEqual(result.blocks, []);
  });

  it('extracts description summary (first lines)', () => {
    const result = parseBdShow(BD_SHOW_AFK_CODING);
    assert.ok(result.descriptionSummary.includes('Implements the second task'));
  });

  it('handles all stage values', () => {
    for (const stage of ['reviewing', 'fixing', 'documenting'] as const) {
      const output = `LABELS: implementation-type:afk, stage:${stage}`;
      const result = parseBdShow(output);
      assert.equal(result.stage, stage);
    }
  });

  it('parses epicId from epic: label', () => {
    const output = `○ proj-child · Child task   [● P2 · OPEN]
Owner: Jane · Type: task
Created: 2026-01-01 · Updated: 2026-01-01

DESCRIPTION
Child task description.

LABELS: implementation-type:afk, epic:proj-epic`;
    const result = parseBdShow(output);
    assert.equal(result.epicId, 'proj-epic');
  });

  it('leaves epicId null when no epic: label', () => {
    const result = parseBdShow(BD_SHOW_HITL);
    assert.equal(result.epicId, null);
  });
});

// ─── Behavior 4: build status badge ──────────────────────────────────────────

describe('buildStatusBadge', () => {
  it('open afk bead → ⏳🤖', () => {
    const bead = makeBead({ status: 'open', classification: 'afk', stage: null });
    assert.equal(buildStatusBadge(bead), '⏳🤖');
  });

  it('in_progress afk bead with coding stage → ▶️🤖🔨', () => {
    const bead = makeBead({ status: 'in_progress', classification: 'afk', stage: 'coding' });
    assert.equal(buildStatusBadge(bead), '▶️🤖🔨');
  });

  it('in_progress hitl reviewing → ▶️🙋👁', () => {
    const bead = makeBead({ status: 'in_progress', classification: 'hitl', stage: 'reviewing' });
    assert.equal(buildStatusBadge(bead), '▶️🙋👁');
  });

  it('blocked unknown → 🔒', () => {
    const bead = makeBead({ status: 'blocked', classification: 'unknown', stage: null });
    assert.equal(buildStatusBadge(bead), '🔒');
  });

  it('closed afk → ✅🤖', () => {
    const bead = makeBead({ status: 'closed', classification: 'afk', stage: null });
    assert.equal(buildStatusBadge(bead), '✅🤖');
  });

  it('deferred hitl → ❌🙋', () => {
    const bead = makeBead({ status: 'deferred', classification: 'hitl', stage: null });
    assert.equal(buildStatusBadge(bead), '❌🙋');
  });

  it('sub-status not shown when not in_progress', () => {
    // Even if stage is set, sub-status only shows for in_progress
    const bead = makeBead({ status: 'open', classification: 'afk', stage: 'coding' });
    assert.equal(buildStatusBadge(bead), '⏳🤖');
  });
});

// ─── Behavior 5: detect orphaned blocked beads ────────────────────────────────

describe('detectOrphanedBlocked', () => {
  it('returns empty when no blocked beads', () => {
    const beads = [makeBead({ status: 'open' }), makeBead({ id: 'proj-b', status: 'closed' })];
    assert.deepEqual(detectOrphanedBlocked(beads), []);
  });

  it('returns blocked bead when all its deps are closed', () => {
    const beads: Bead[] = [
      makeBead({ id: 'proj-a', status: 'closed' }),
      makeBead({ id: 'proj-b', status: 'blocked', blockedBy: ['proj-a'] }),
    ];
    const orphaned = detectOrphanedBlocked(beads);
    assert.equal(orphaned.length, 1);
    assert.equal(orphaned[0].id, 'proj-b');
  });

  it('does not return blocked bead when some deps are still open', () => {
    const beads: Bead[] = [
      makeBead({ id: 'proj-a', status: 'open' }),
      makeBead({ id: 'proj-b', status: 'blocked', blockedBy: ['proj-a'] }),
    ];
    assert.deepEqual(detectOrphanedBlocked(beads), []);
  });

  it('returns blocked bead with no blockedBy entries (no tracked deps)', () => {
    const beads: Bead[] = [makeBead({ id: 'proj-b', status: 'blocked', blockedBy: [] })];
    const orphaned = detectOrphanedBlocked(beads);
    assert.equal(orphaned.length, 1);
  });
});

// ─── Behavior 6: render Mermaid graph ────────────────────────────────────────

describe('renderMermaidGraph', () => {
  it('opens and closes mermaid code block', () => {
    const output = renderMermaidGraph([]);
    assert.ok(output.startsWith('```mermaid\ngraph TD'));
    assert.ok(output.endsWith('```'));
  });

  it('includes a node for each incomplete bead', () => {
    const beads = [
      makeBead({ id: 'proj-aaa', title: 'Task A', status: 'open' }),
      makeBead({ id: 'proj-bbb', title: 'Task B', status: 'in_progress' }),
    ];
    const output = renderMermaidGraph(beads);
    assert.ok(output.includes('proj_aaa'));
    assert.ok(output.includes('proj_bbb'));
  });

  it('excludes closed beads from graph', () => {
    const beads = [
      makeBead({ id: 'proj-aaa', status: 'open' }),
      makeBead({ id: 'proj-bbb', status: 'closed' }),
    ];
    const output = renderMermaidGraph(beads);
    assert.ok(output.includes('proj_aaa'));
    assert.ok(!output.includes('proj_bbb'));
  });

  it('renders dependency edges between incomplete beads', () => {
    const beads: Bead[] = [
      makeBead({ id: 'proj-aaa', status: 'open', blocks: ['proj-bbb'] }),
      makeBead({ id: 'proj-bbb', status: 'open', blockedBy: ['proj-aaa'] }),
    ];
    const output = renderMermaidGraph(beads);
    assert.ok(output.includes('proj_aaa --> proj_bbb'));
  });

  it('does not render edge to closed bead', () => {
    const beads: Bead[] = [
      makeBead({ id: 'proj-aaa', status: 'open', blocks: ['proj-bbb'] }),
      makeBead({ id: 'proj-bbb', status: 'closed' }),
    ];
    const output = renderMermaidGraph(beads);
    assert.ok(!output.includes('proj_aaa --> proj_bbb'));
  });

  it('wraps beads with epicId in a subgraph', () => {
    const beads: Bead[] = [
      makeBead({ id: 'proj-epic', title: 'The Epic', status: 'open' }),
      makeBead({ id: 'proj-child', title: 'Child task', status: 'open', epicId: 'proj-epic' }),
    ];
    const output = renderMermaidGraph(beads);
    assert.ok(output.includes('subgraph sg_proj_epic'));
    assert.ok(output.includes('proj_child'));
  });

  it('collapses nodes beyond 5 at the same depth into a summary node', () => {
    // 6 independent root nodes (no deps), all at depth 0
    const beads: Bead[] = [
      makeBead({ id: 'proj-a1', status: 'open', classification: 'afk' }),
      makeBead({ id: 'proj-a2', status: 'open', classification: 'afk' }),
      makeBead({ id: 'proj-a3', status: 'open', classification: 'hitl' }),
      makeBead({ id: 'proj-a4', status: 'open', classification: 'afk' }),
      makeBead({ id: 'proj-a5', status: 'open', classification: 'afk' }),
      makeBead({ id: 'proj-a6', status: 'open', classification: 'hitl' }),
    ];
    const output = renderMermaidGraph(beads);
    // First 5 rendered normally
    assert.ok(output.includes('proj_a1'));
    assert.ok(output.includes('proj_a2'));
    assert.ok(output.includes('proj_a3'));
    assert.ok(output.includes('proj_a4'));
    assert.ok(output.includes('proj_a5'));
    // 6th collapsed into summary; proj_a6 should not appear as standalone node
    assert.ok(!output.includes('proj_a6'));
    // Summary node: 1 collapsed, 0 afk, 1 hitl
    assert.ok(output.includes('+1 more (0 🤖, 1 🙋)'));
  });

  it('summary node inherits edges to children of collapsed nodes', () => {
    // 6 root nodes; the 6th (proj-a6) blocks proj-child
    const beads: Bead[] = [
      makeBead({ id: 'proj-a1', status: 'open', classification: 'afk' }),
      makeBead({ id: 'proj-a2', status: 'open', classification: 'afk' }),
      makeBead({ id: 'proj-a3', status: 'open', classification: 'afk' }),
      makeBead({ id: 'proj-a4', status: 'open', classification: 'afk' }),
      makeBead({ id: 'proj-a5', status: 'open', classification: 'afk' }),
      makeBead({ id: 'proj-a6', status: 'open', classification: 'afk', blocks: ['proj-child'] }),
      makeBead({ id: 'proj-child', status: 'open', classification: 'afk', blockedBy: ['proj-a6'] }),
    ];
    const output = renderMermaidGraph(beads);
    // proj-child is at depth 1 → visible
    assert.ok(output.includes('proj_child'));
    // Summary node should edge to proj-child
    assert.ok(output.includes('summary_d0 --> proj_child'));
  });
});

// ─── Behavior 7: render active work table ────────────────────────────────────

describe('renderActiveWorkTable', () => {
  it('returns placeholder when no active work', () => {
    const beads = [makeBead({ status: 'closed' })];
    const output = renderActiveWorkTable(beads);
    assert.equal(output, '_No active work._');
  });

  it('includes table headers', () => {
    const beads = [makeBead({ status: 'open' })];
    const output = renderActiveWorkTable(beads);
    assert.ok(output.includes('| Code | Title | Status | Blocked by |'));
  });

  it('includes bead id, title, and badge in row', () => {
    const bead = makeBead({ id: 'proj-abc', title: 'My task', status: 'open', classification: 'afk' });
    const output = renderActiveWorkTable([bead]);
    assert.ok(output.includes('proj-abc'));
    assert.ok(output.includes('My task'));
    assert.ok(output.includes('⏳🤖'));
  });

  it('shows blocker id and badge in blocked-by column', () => {
    const beads: Bead[] = [
      makeBead({ id: 'proj-a', status: 'open', classification: 'afk' }),
      makeBead({ id: 'proj-b', status: 'blocked', classification: 'hitl', blockedBy: ['proj-a'] }),
    ];
    const output = renderActiveWorkTable(beads);
    assert.ok(output.includes('proj-a ⏳🤖'));
  });

  it('excludes closed beads from active table', () => {
    const beads = [
      makeBead({ id: 'proj-active', status: 'open' }),
      makeBead({ id: 'proj-done', status: 'closed' }),
    ];
    const output = renderActiveWorkTable(beads);
    assert.ok(output.includes('proj-active'));
    assert.ok(!output.includes('proj-done'));
  });
});

// ─── Behavior 8: render completed section ────────────────────────────────────

describe('renderCompletedSection', () => {
  it('returns placeholder when nothing completed', () => {
    const beads = [makeBead({ status: 'open' })];
    const output = renderCompletedSection(beads);
    assert.equal(output, '_Nothing completed yet._');
  });

  it('includes table headers', () => {
    const beads = [makeBead({ status: 'closed' })];
    const output = renderCompletedSection(beads);
    assert.ok(output.includes('| Code | Title | Summary |'));
  });

  it('includes id, title, and description summary', () => {
    const bead = makeBead({
      id: 'proj-done',
      title: 'Done task',
      status: 'closed',
      descriptionSummary: 'It was done',
    });
    const output = renderCompletedSection([bead]);
    assert.ok(output.includes('proj-done'));
    assert.ok(output.includes('Done task'));
    assert.ok(output.includes('It was done'));
  });

  it('excludes non-closed beads', () => {
    const beads = [
      makeBead({ id: 'proj-active', status: 'open' }),
      makeBead({ id: 'proj-done', status: 'closed' }),
    ];
    const output = renderCompletedSection(beads);
    assert.ok(!output.includes('proj-active'));
    assert.ok(output.includes('proj-done'));
  });
});

// ─── Behavior 9: orphaned blocked callout ────────────────────────────────────

describe('renderOrphanedBlockedCallout', () => {
  it('returns empty string when no orphaned beads', () => {
    const beads = [makeBead({ status: 'open' })];
    assert.equal(renderOrphanedBlockedCallout(beads), '');
  });

  it('includes warning heading and bead id', () => {
    const beads: Bead[] = [
      makeBead({ id: 'proj-a', status: 'closed' }),
      makeBead({ id: 'proj-b', status: 'blocked', blockedBy: ['proj-a'] }),
    ];
    const output = renderOrphanedBlockedCallout(beads);
    assert.ok(output.includes('Orphaned Blocked Beads'));
    assert.ok(output.includes('proj-b'));
  });
});

// ─── Behavior 10: full markdown render ───────────────────────────────────────

describe('renderMarkdown', () => {
  it('contains all three section headings', () => {
    const beads = [makeBead()];
    const output = renderMarkdown(beads);
    assert.ok(output.includes('## Dependency Graph'));
    assert.ok(output.includes('## Active Work'));
    assert.ok(output.includes('## Completed'));
  });

  it('includes mermaid code block', () => {
    const output = renderMarkdown([makeBead()]);
    assert.ok(output.includes('```mermaid'));
  });

  it('does not include orphaned callout section when none exist', () => {
    const output = renderMarkdown([makeBead({ status: 'open' })]);
    assert.ok(!output.includes('Orphaned Blocked'));
  });

  it('includes orphaned callout when orphaned beads exist', () => {
    const beads: Bead[] = [
      makeBead({ id: 'proj-a', status: 'closed' }),
      makeBead({ id: 'proj-b', status: 'blocked', blockedBy: ['proj-a'] }),
    ];
    const output = renderMarkdown(beads);
    assert.ok(output.includes('Orphaned Blocked'));
  });
});

// ─── Behavior 11: fetchBeads (data fetch integration) ────────────────────────

describe('fetchBeads', () => {
  const mockExec = (cmd: string, _cwd: string): string => {
    if (cmd === 'bd list') return BD_LIST_OUTPUT;
    if (cmd === 'bd list --status=closed') return '✓ proj-ddd ● P3 Completed task\n';
    if (cmd === 'bd show proj-aaa') return BD_SHOW_HITL;
    if (cmd === 'bd show proj-bbb') return BD_SHOW_AFK_CODING;
    if (cmd === 'bd show proj-ccc') return BD_SHOW_NO_LABELS;
    if (cmd === 'bd show proj-ddd') return '✓ proj-ddd · Completed task\nLABELS: implementation-type:afk\n';
    if (cmd === 'bd show proj-eee') return '❄ proj-eee · Deferred task\nLABELS: implementation-type:afk\n';
    return '';
  };

  it('fetches and assembles all beads without duplicates', () => {
    const beads = fetchBeads('/workspace', mockExec);
    const ids = beads.map((b) => b.id);
    // proj-ddd appears in both bd list and bd list --status=closed, should be deduplicated
    assert.equal(ids.filter((id) => id === 'proj-ddd').length, 1);
    assert.equal(beads.length, 5);
  });

  it('assembles correct classification from bd show', () => {
    const beads = fetchBeads('/workspace', mockExec);
    const bbb = beads.find((b) => b.id === 'proj-bbb');
    assert.equal(bbb?.classification, 'afk');
    assert.equal(bbb?.stage, 'coding');
  });

  it('assembles blockedBy and blocks from bd show', () => {
    const beads = fetchBeads('/workspace', mockExec);
    const bbb = beads.find((b) => b.id === 'proj-bbb');
    assert.deepEqual(bbb?.blockedBy, ['proj-aaa']);
    assert.deepEqual(bbb?.blocks, ['proj-ccc']);
  });
});
