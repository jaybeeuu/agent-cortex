import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '..', '..', '..');

const REQUIRED_REFERENCE_FILES = [
  'references/skill-anatomy.md',
  'references/testing-patterns.md',
  'references/security-checklist.md',
  'references/performance-checklist.md',
  'references/accessibility-checklist.md',
];

const LEGACY_SHARED_DOCS = ['skills/tdd/tests.md'];

describe('references baseline docs', () => {
  it('includes the required shared reference files', () => {
    for (const relativeFile of REQUIRED_REFERENCE_FILES) {
      const absoluteFile = path.join(repoRoot, relativeFile);
      assert.equal(
        fs.existsSync(absoluteFile),
        true,
        `Expected shared reference file to exist: ${relativeFile}`,
      );
    }
  });

  it('moves shared guidance docs into references', () => {
    for (const relativeFile of LEGACY_SHARED_DOCS) {
      const absoluteFile = path.join(repoRoot, relativeFile);
      assert.equal(
        fs.existsSync(absoluteFile),
        false,
        `Expected legacy shared doc to be moved under references/: ${relativeFile}`,
      );
    }
  });

  it('updates skills to link to shared references', () => {
    const styleCodeSkill = fs.readFileSync(
      path.join(repoRoot, 'skills/style-code/SKILL.md'),
      'utf8',
    );
    assert.match(
      styleCodeSkill,
      /references\/testing-patterns\.md/,
      'Expected style-code skill to link to references/testing-patterns.md',
    );
    assert.doesNotMatch(
      styleCodeSkill,
      /skills\/tdd\/tests\.md/,
      'Expected style-code skill to stop linking legacy shared docs under skills/tdd/',
    );
  });
});
