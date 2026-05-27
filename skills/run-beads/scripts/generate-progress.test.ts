import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchBeads, renderMarkdown } from './generate-progress.ts';

describe('generate-progress executable workflows', () => {
  it('renders a mixed parent/chore workflow into progress markdown', () => {
    const mockExec = (cmd: string, _cwd: string): string => {
      if (cmd === 'bd list') {
        return [
          '◐ proj-parent ● P1 Parent task',
          '◐ proj-code ● P1 Code stage',
          '○ proj-review ● P1 Review stage',
        ].join('\n');
      }
      if (cmd === 'bd list --status=closed') {
        return '✓ proj-closed ● P2 Closed task\n';
      }
      if (cmd === 'bd show proj-parent') {
        return [
          '◐ proj-parent · Parent task   [● P1 · IN_PROGRESS]',
          'Owner: Jane · Type: task',
          '',
          'DESCRIPTION',
          'Deliver parent workflow.',
          '',
          'LABELS: implementation-type:afk, stage:coding',
        ].join('\n');
      }
      if (cmd === 'bd show proj-code') {
        return [
          '◐ proj-code · Code stage   [● P1 · IN_PROGRESS]',
          'Owner: Jane · Type: chore · Parent: proj-parent',
          '',
          'DESCRIPTION',
          'Implement code changes.',
          '',
          'LABELS: implementation-type:afk, stage:code',
          '',
          'BLOCKS',
          '  ← ○ proj-review: Review stage ● P1',
        ].join('\n');
      }
      if (cmd === 'bd show proj-review') {
        return [
          '○ proj-review · Review stage   [● P1 · OPEN]',
          'Owner: Jane · Type: chore · Parent: proj-parent',
          '',
          'DESCRIPTION',
          'Review workflow outcome.',
          '',
          'LABELS: implementation-type:hitl, stage:review',
          '',
          'DEPENDS ON',
          '  → ◐ proj-code: Code stage ● P1',
        ].join('\n');
      }
      if (cmd === 'bd show proj-closed') {
        return [
          '✓ proj-closed · Closed task   [● P2 · CLOSED]',
          'Owner: Jane · Type: task',
          '',
          'DESCRIPTION',
          'Already complete.',
          '',
          'LABELS: implementation-type:afk',
        ].join('\n');
      }
      return '';
    };

    const markdown = renderMarkdown(fetchBeads('/workspace', mockExec));

    assert.ok(markdown.includes('## Dependency Graph'));
    assert.ok(markdown.includes('## Tasks'));
    assert.ok(markdown.includes('subgraph sg_proj_parent'));
    assert.ok(markdown.includes('proj_code --> proj_review'));
    assert.ok(markdown.includes('proj-closed'));
    assert.ok(markdown.includes('| Code | Title | Status | Blocked by | Summary |'));
  });

  it('expands epic children from bd children and renders epic grouping', () => {
    const mockExec = (cmd: string, _cwd: string): string => {
      if (cmd === 'bd list') return '○ proj-epic ● P1 [epic] Auth\n';
      if (cmd === 'bd list --status=closed') return '';
      if (cmd === 'bd children proj-epic') return '○ proj-child ● P2 Sign in\n';
      if (cmd === 'bd show proj-epic') {
        return [
          '○ proj-epic · [epic] Auth   [● P1 · OPEN]',
          'Owner: Jane · Type: epic',
          '',
          'DESCRIPTION',
          'Authentication epic.',
          '',
          'LABELS: implementation-type:hitl',
        ].join('\n');
      }
      if (cmd === 'bd show proj-child') {
        return [
          '○ proj-child · Sign in   [● P2 · OPEN]',
          'Owner: Jane · Type: task',
          '',
          'DESCRIPTION',
          'Implement sign-in path.',
          '',
          'LABELS: implementation-type:afk, epic:proj-epic',
        ].join('\n');
      }
      return '';
    };

    const markdown = renderMarkdown(fetchBeads('/workspace', mockExec));
    assert.ok(markdown.includes('sg_proj_epic'));
    assert.ok(markdown.includes('proj-child'));
  });

  it('calls out blocked beads with no unresolved dependencies', () => {
    const mockExec = (cmd: string, _cwd: string): string => {
      if (cmd === 'bd list') return '● proj-blocked ● P2 Blocked task\n';
      if (cmd === 'bd list --status=closed') return '✓ proj-done ● P1 Done\n';
      if (cmd === 'bd show proj-blocked') {
        return [
          '● proj-blocked · Blocked task   [● P2 · BLOCKED]',
          'Owner: Jane · Type: task',
          '',
          'DESCRIPTION',
          'Waiting but dependency is already closed.',
          '',
          'LABELS: implementation-type:afk',
          '',
          'DEPENDS ON',
          '  → ✓ proj-done: Done ● P1',
        ].join('\n');
      }
      if (cmd === 'bd show proj-done') {
        return [
          '✓ proj-done · Done   [● P1 · CLOSED]',
          'Owner: Jane · Type: task',
          '',
          'DESCRIPTION',
          'Completed dependency.',
          '',
          'LABELS: implementation-type:afk',
        ].join('\n');
      }
      return '';
    };

    const markdown = renderMarkdown(fetchBeads('/workspace', mockExec));
    assert.ok(markdown.includes('Orphaned Blocked Beads'));
    assert.ok(markdown.includes('proj-blocked'));
  });
});
