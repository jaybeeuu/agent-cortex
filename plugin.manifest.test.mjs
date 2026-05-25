import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('./plugin.json', import.meta.url), 'utf8')
);

test('plugin manifest lists agents as explicit file paths', () => {
  assert.ok(Array.isArray(manifest.agents), 'agents must be an array of file paths');
  assert.deepEqual(manifest.agents, ['agents/ralph.agent.md']);
});
