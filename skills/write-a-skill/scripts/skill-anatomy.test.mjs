import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const skillPath = resolve(currentDir, '..', 'SKILL.md');

async function readSkill() {
  return readFile(skillPath, 'utf8');
}

describe('write-a-skill anatomy', () => {
  it('includes the required upstream anatomy sections', async () => {
    const skill = await readSkill();

    const requiredSections = [
      '## Overview',
      '## When to use',
      '## When not to use',
      '## Common rationalizations',
      '## Red flags',
      '## Verification',
    ];

    for (const heading of requiredSections) {
      assert.match(skill, new RegExp(`^${heading}$`, 'm'));
    }
  });

  it('requires evidence-based and convention-aligned verification guidance', async () => {
    const skill = await readSkill();
    const verificationSection = skill.split(/^## Verification$/m)[1] ?? '';
    const proofLine =
      verificationSection
        .split('\n')
        .find((line) => line.includes('**Proof of correctness**')) ?? '';

    assert.match(verificationSection, /cite exact command output/i);
    assert.match(proofLine, /\b\d+\s+passed,\s+\d+\s+failed\b/i);
    assert.match(proofLine, /\bexit code\b[^.\n]*\b\d+\b/i);
    assert.match(verificationSection, /Use when/i);
    assert.match(verificationSection, /1024/);
  });
});
