import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BeadStatus = 'open' | 'in_progress' | 'blocked' | 'closed' | 'deferred';
export type Classification = 'afk' | 'hitl' | 'unknown';
export type Stage = 'coding' | 'reviewing' | 'fixing' | 'documenting' | null;

export interface Bead {
  id: string;
  title: string;
  status: BeadStatus;
  classification: Classification;
  stage: Stage;
  epicId: string | null;
  blockedBy: string[];
  blocks: string[];
  descriptionSummary: string;
}

export type ExecFn = (cmd: string, cwd: string) => string;

// ─── Data Fetch Layer ─────────────────────────────────────────────────────────

const STATUS_CHAR_MAP: Record<string, BeadStatus> = {
  '○': 'open',
  '◐': 'in_progress',
  '●': 'blocked',
  '✓': 'closed',
  '❄': 'deferred',
};

export function parseListLine(
  line: string,
): { id: string; status: BeadStatus; title: string } | null {
  // Format: {STATUS_CHAR} {ID} ● P{N} {TITLE}
  const match = line.trim().match(/^([○◐●✓❄])\s+(\S+)\s+●\s+P\d+\s+(.+)$/);
  if (!match) return null;
  const [, statusChar, id, title] = match;
  const status = STATUS_CHAR_MAP[statusChar];
  if (!status) return null;
  return { id, status, title: title.trim() };
}

export function parseBdList(
  output: string,
): Array<{ id: string; status: BeadStatus; title: string }> {
  return output
    .split('\n')
    .map((line) => parseListLine(line))
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

export function parseBdShow(output: string): Omit<Bead, 'id' | 'title' | 'status'> {
  const labels: string[] = [];
  const blockedBy: string[] = [];
  const blocks: string[] = [];
  const descriptionLines: string[] = [];
  let epicId: string | null = null;
  let inDescription = false;
  let inBlocks = false;
  let inDependsOn = false;

  for (const line of output.split('\n')) {
    const trimmed = line.trim();

    if (trimmed === 'DESCRIPTION') {
      inDescription = true;
      inBlocks = false;
      inDependsOn = false;
      continue;
    }
    if (trimmed === 'BLOCKS') {
      inBlocks = true;
      inDescription = false;
      inDependsOn = false;
      continue;
    }
    if (trimmed === 'DEPENDS ON') {
      inDependsOn = true;
      inBlocks = false;
      inDescription = false;
      continue;
    }
    if (trimmed.startsWith('LABELS:')) {
      inDescription = false;
      inBlocks = false;
      inDependsOn = false;
      const labelPart = trimmed.replace('LABELS:', '').trim();
      labels.push(...labelPart.split(',').map((l) => l.trim()).filter(Boolean));
      continue;
    }
    // Other known section headers reset context
    if (/^(Owner:|Created:|Assignee:|Type:)/.test(trimmed)) {
      inDescription = false;
      inBlocks = false;
      inDependsOn = false;
    }

    if (inBlocks && trimmed.startsWith('←')) {
      // ← ○ agent-nexus-6d4: Title ● P1
      const match = trimmed.match(/←\s+[○◐●✓❄]\s+(\S+):/);
      if (match) blocks.push(match[1]);
    } else if (inDependsOn && trimmed.startsWith('→')) {
      // → ◐ agent-nexus-wuo: Title ● P1
      const match = trimmed.match(/→\s+[○◐●✓❄]\s+(\S+):/);
      if (match) blockedBy.push(match[1]);
    } else if (inDescription && trimmed !== '' && descriptionLines.length < 3) {
      descriptionLines.push(trimmed);
    }
  }

  let classification: Classification = 'unknown';
  let stage: Stage = null;

  for (const label of labels) {
    if (label === 'implementation-type:afk') classification = 'afk';
    else if (label === 'implementation-type:hitl') classification = 'hitl';
    else if (label.startsWith('stage:')) {
      const stagePart = label.replace('stage:', '');
      if (['coding', 'reviewing', 'fixing', 'documenting'].includes(stagePart)) {
        stage = stagePart as NonNullable<Stage>;
      }
    } else if (label.startsWith('epic:')) {
      epicId = label.slice('epic:'.length);
    }
  }

  return {
    classification,
    stage,
    epicId,
    blockedBy,
    blocks,
    descriptionSummary: descriptionLines.join(' ').substring(0, 120),
  };
}

export function fetchBeads(workspace: string, exec: ExecFn = defaultExec): Bead[] {
  const allOutput = exec('bd list', workspace);
  const closedOutput = exec('bd list --status=closed', workspace);

  const seen = new Set<string>();
  const uniqueItems = [...parseBdList(allOutput), ...parseBdList(closedOutput)].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return uniqueItems.map((item) => {
    const showOutput = exec(`bd show ${item.id}`, workspace);
    const details = parseBdShow(showOutput);
    return { id: item.id, title: item.title, status: item.status, ...details };
  });
}

function defaultExec(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8' });
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

export function buildStatusBadge(bead: Pick<Bead, 'status' | 'classification' | 'stage'>): string {
  let topLevel: string;
  switch (bead.status) {
    case 'in_progress':
      topLevel = '▶️';
      break;
    case 'open':
      topLevel = '⏳';
      break;
    case 'blocked':
      topLevel = '🔒';
      break;
    case 'closed':
      topLevel = '✅';
      break;
    case 'deferred':
      topLevel = '❌';
      break;
  }

  const classification =
    bead.classification === 'afk' ? '🤖' : bead.classification === 'hitl' ? '🙋' : '';

  let subStatus = '';
  if (bead.status === 'in_progress' && bead.stage) {
    switch (bead.stage) {
      case 'coding':
        subStatus = '🔨';
        break;
      case 'reviewing':
        subStatus = '👁';
        break;
      case 'fixing':
        subStatus = '🔧';
        break;
      case 'documenting':
        subStatus = '📝';
        break;
    }
  }

  return `${topLevel}${classification}${subStatus}`;
}

// ─── Render Layer ─────────────────────────────────────────────────────────────

function mermaidId(id: string): string {
  return id.replace(/-/g, '_');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max - 3) + '...' : s;
}

function computeBfsDepths(incomplete: Bead[], incompleteIds: Set<string>): Map<string, number> {
  const depths = new Map<string, number>();

  const hasIncomingEdge = new Set<string>();
  for (const bead of incomplete) {
    for (const blockId of bead.blocks) {
      if (incompleteIds.has(blockId)) hasIncomingEdge.add(blockId);
    }
  }

  const beadMap = new Map(incomplete.map((b) => [b.id, b]));
  const queue: string[] = [];
  for (const bead of incomplete) {
    if (!hasIncomingEdge.has(bead.id)) {
      depths.set(bead.id, 0);
      queue.push(bead.id);
    }
  }

  let i = 0;
  while (i < queue.length) {
    const id = queue[i++];
    const depth = depths.get(id)!;
    const bead = beadMap.get(id);
    if (!bead) continue;
    for (const childId of bead.blocks) {
      if (incompleteIds.has(childId) && !depths.has(childId)) {
        depths.set(childId, depth + 1);
        queue.push(childId);
      }
    }
  }

  // Assign remaining nodes (cycles/disconnected) past the max depth
  const maxDepth = depths.size > 0 ? Math.max(...depths.values()) : -1;
  let nextDepth = maxDepth + 1;
  for (const bead of incomplete) {
    if (!depths.has(bead.id)) depths.set(bead.id, nextDepth);
  }

  return depths;
}

export function detectOrphanedBlocked(beads: Bead[]): Bead[] {
  const beadMap = new Map(beads.map((b) => [b.id, b]));
  return beads.filter((bead) => {
    if (bead.status !== 'blocked') return false;
    const hasUnresolved = bead.blockedBy.some((depId) => {
      const dep = beadMap.get(depId);
      return dep == null || dep.status !== 'closed';
    });
    return !hasUnresolved;
  });
}

const DEPTH_CUTOFF = 5;

export function renderMermaidGraph(beads: Bead[]): string {
  const beadMap = new Map(beads.map((b) => [b.id, b]));
  const incomplete = beads.filter((b) => b.status !== 'closed');

  const incompleteIds = new Set(incomplete.map((b) => b.id));
  const depths = computeBfsDepths(incomplete, incompleteIds);

  // Group by BFS depth
  const maxDepth = incomplete.length > 0 ? Math.max(...depths.values()) : -1;
  const byDepth: Bead[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const bead of incomplete) {
    byDepth[depths.get(bead.id) ?? 0].push(bead);
  }

  // Apply per-level cutoff
  const visibleIds = new Set<string>();
  const collapsedIds = new Set<string>();

  interface SummaryNode {
    mid: string; // mermaid id, e.g. "summary_d0"
    depth: number;
    count: number;
    afkCount: number;
    hitlCount: number;
    childIds: string[];
  }
  const summaryNodes: SummaryNode[] = [];

  for (let d = 0; d < byDepth.length; d++) {
    const level = byDepth[d];
    if (level.length <= DEPTH_CUTOFF) {
      level.forEach((b) => visibleIds.add(b.id));
    } else {
      level.slice(0, DEPTH_CUTOFF).forEach((b) => visibleIds.add(b.id));
      const collapsed = level.slice(DEPTH_CUTOFF);
      collapsed.forEach((b) => collapsedIds.add(b.id));
      const afkCount = collapsed.filter((b) => b.classification === 'afk').length;
      const hitlCount = collapsed.filter((b) => b.classification === 'hitl').length;
      const childIds = [
        ...new Set(
          collapsed.flatMap((b) => b.blocks.filter((id) => incompleteIds.has(id))),
        ),
      ];
      summaryNodes.push({ mid: `summary_d${d}`, depth: d, count: collapsed.length, afkCount, hitlCount, childIds });
    }
  }

  // Group visible beads by epic
  const epicGroups = new Map<string, Bead[]>();
  const noEpic: Bead[] = [];
  for (const bead of incomplete) {
    if (!visibleIds.has(bead.id)) continue;
    if (bead.epicId) {
      const group = epicGroups.get(bead.epicId) ?? [];
      group.push(bead);
      epicGroups.set(bead.epicId, group);
    } else {
      noEpic.push(bead);
    }
  }

  const lines: string[] = ['```mermaid', 'graph TD'];

  const renderNode = (bead: Bead, indent: string): void => {
    const badge = buildStatusBadge(bead);
    const label = truncate(bead.title, 45);
    lines.push(`${indent}${mermaidId(bead.id)}["${badge} ${bead.id}<br/>${label}"]`);
  };

  for (const [epicId, members] of epicGroups) {
    const epic = beadMap.get(epicId);
    lines.push(`  subgraph sg_${mermaidId(epicId)}["📦 ${epic?.title ?? epicId}"]`);
    for (const bead of members) {
      renderNode(bead, '    ');
    }
    lines.push('  end');
  }

  for (const bead of noEpic) {
    renderNode(bead, '  ');
  }

  // Render summary nodes
  for (const sn of summaryNodes) {
    lines.push(`  ${sn.mid}["+${sn.count} more (${sn.afkCount} 🤖, ${sn.hitlCount} 🙋)"]`);
  }

  // Helper: resolve a bead id to the mermaid id to use (may be a summary node)
  const resolveTargetMid = (targetId: string): string | null => {
    if (visibleIds.has(targetId)) return mermaidId(targetId);
    if (collapsedIds.has(targetId)) {
      const d = depths.get(targetId);
      if (d === undefined) return null;
      const sn = summaryNodes.find((s) => s.depth === d);
      return sn?.mid ?? null;
    }
    return null;
  };

  // Edges from visible beads
  for (const bead of incomplete) {
    if (!visibleIds.has(bead.id)) continue;
    for (const blockId of bead.blocks) {
      const target = resolveTargetMid(blockId);
      if (target) lines.push(`  ${mermaidId(bead.id)} --> ${target}`);
    }
  }

  // Edges from summary nodes to their children
  for (const sn of summaryNodes) {
    const emitted = new Set<string>();
    for (const childId of sn.childIds) {
      const target = resolveTargetMid(childId);
      if (target && !emitted.has(target)) {
        emitted.add(target);
        lines.push(`  ${sn.mid} --> ${target}`);
      }
    }
  }

  lines.push('```');
  return lines.join('\n');
}

export function renderActiveWorkTable(beads: Bead[]): string {
  const beadMap = new Map(beads.map((b) => [b.id, b]));
  const active = beads.filter((b) => b.status !== 'closed');

  if (active.length === 0) return '_No active work._';

  const rows = active.map((bead) => {
    const badge = buildStatusBadge(bead);
    const blockedByStr =
      bead.blockedBy.length > 0
        ? bead.blockedBy
            .map((depId) => {
              const dep = beadMap.get(depId);
              return dep ? `${depId} ${buildStatusBadge(dep)}` : depId;
            })
            .join(', ')
        : '';
    return `| ${bead.id} | ${bead.title} | ${badge} | ${blockedByStr} |`;
  });

  return [
    '| Code | Title | Status | Blocked by |',
    '|------|-------|--------|------------|',
    ...rows,
  ].join('\n');
}

export function renderCompletedSection(beads: Bead[]): string {
  const completed = beads.filter((b) => b.status === 'closed');

  if (completed.length === 0) return '_Nothing completed yet._';

  const rows = completed.map(
    (bead) =>
      `| ${bead.id} | ${bead.title} | ${bead.descriptionSummary || '_no summary_'} |`,
  );

  return [
    '| Code | Title | Summary |',
    '|------|-------|---------|',
    ...rows,
  ].join('\n');
}

export function renderOrphanedBlockedCallout(beads: Bead[]): string {
  const orphaned = detectOrphanedBlocked(beads);
  if (orphaned.length === 0) return '';

  const items = orphaned
    .map((b) => `> - **${b.id}**: ${b.title}`)
    .join('\n');
  return `> ⚠️ **Orphaned Blocked Beads** — marked blocked but have no unresolved dependencies:\n>\n${items}\n`;
}

export function renderMarkdown(beads: Bead[]): string {
  const parts: string[] = [];

  parts.push('## Dependency Graph\n');
  parts.push(renderMermaidGraph(beads));
  parts.push('');

  const callout = renderOrphanedBlockedCallout(beads);
  if (callout) {
    parts.push(callout);
    parts.push('');
  }

  parts.push('## Active Work\n');
  parts.push(renderActiveWorkTable(beads));
  parts.push('');

  parts.push('## Completed\n');
  parts.push(renderCompletedSection(beads));
  parts.push('');

  return parts.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function parseCliArgs(args: string[]): { workspace: string } {
  let workspace = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && args[i + 1]) {
      workspace = resolve(args[i + 1]);
      i++;
    }
  }
  return { workspace };
}

async function main(): Promise<void> {
  const { workspace } = parseCliArgs(process.argv.slice(2));
  const beads = fetchBeads(workspace);
  process.stdout.write(renderMarkdown(beads));
}

// Only run when executed directly, not when imported (e.g. by tests)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
