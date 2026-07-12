import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stage {
  id: string;
  title: string;
  description: string;
  template: string;
  dependsOn: string[];
}

interface Pipeline {
  maxFixRounds: number;
  stages: Stage[];
}

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(args: string[]): { parentId: string; priority: string } {
  let parentId: string | undefined;
  let priority = '2';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--parent' && args[i + 1]) { parentId = args[++i]; }
    else if (args[i] === '--priority' && args[i + 1]) { priority = args[++i]; }
  }

  if (!parentId) {
    console.error('Usage: create-chores.ts --parent <bead-id> [--priority <0-4>]');
    process.exit(1);
  }

  return { parentId, priority };
}

// ─── Exec ─────────────────────────────────────────────────────────────────────

function run(args: string[]): string {
  return execSync(args.join(' '), { encoding: 'utf-8' }).trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { parentId, priority } = parseArgs(process.argv.slice(2));

const pipelinePath = resolve(__dirname, '..', 'pipeline.json');
const pipeline: Pipeline = JSON.parse(readFileSync(pipelinePath, 'utf-8'));

const stageToBeadId = new Map<string, string>();

for (const stage of pipeline.stages) {
  const title = `[${parentId}] ${stage.title}`;

  const beadId = run([
    'bd', 'create', JSON.stringify(title),
    '--type', 'chore',
    '--description', JSON.stringify(stage.description),
    '--priority', priority,
    '--labels', `stage:${stage.id}`,
    '--parent', parentId,
    '--silent',
  ]);

  stageToBeadId.set(stage.id, beadId);

  for (const depStageId of stage.dependsOn) {
    const depBeadId = stageToBeadId.get(depStageId);
    if (!depBeadId) {
      console.error(`Stage '${stage.id}' depends on '${depStageId}', but it has not been created yet. Check dependsOn ordering in pipeline.json.`);
      process.exit(1);
    }
    run(['bd', 'dep', 'add', beadId, depBeadId, '--type', 'blocks']);
  }
}

const finalStageId = pipeline.stages.at(-1)?.id;
if (!finalStageId) {
  console.error('No pipeline stages found in pipeline.json.');
  process.exit(1);
}

const documentStageBeadId = stageToBeadId.get('document') ?? stageToBeadId.get(finalStageId);
if (!documentStageBeadId) {
  console.error('Could not resolve the final stage bead needed for PR gate dependency.');
  process.exit(1);
}

const prGateBeadId = run([
  'bd', 'create', JSON.stringify(`[${parentId}] PR Review and Merge`),
  '--type', 'task',
  '--description', JSON.stringify(
    'Human review gate: review and merge the agent PR into the feature branch before closing this feature.',
  ),
  '--priority', priority,
  '--labels', 'implementation-type:hitl,lifecycle:feature-pr',
  '--parent', parentId,
  '--silent',
]);
run(['bd', 'dep', 'add', prGateBeadId, documentStageBeadId, '--type', 'blocks']);

const result: Record<string, string> = {
  ...Object.fromEntries(stageToBeadId),
  featurePrReview: prGateBeadId,
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
