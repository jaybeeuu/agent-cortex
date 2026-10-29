// Behaviour tests for scripts/lib/skill-frontmatter.mjs — the SKILL.md
// frontmatter check that `pnpm lint` runs. Each case proves one failure mode
// the check must catch: unparseable YAML, a missing name/description field, and
// a description longer than the limit.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_DESCRIPTION_LENGTH,
  checkSkills,
  validateSkillFrontmatter,
} from "../scripts/lib/skill-frontmatter.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Wrap frontmatter lines in a SKILL.md-shaped document. */
function skillDocument(frontmatter) {
  return `---\n${frontmatter}\n---\n\n# Skill body\n`;
}

/** Throwaway directory to lay out a fake skills tree in. */
async function makeFixtureRoot() {
  return await mkdtemp(join(tmpdir(), "agent-cortex-skill-frontmatter-"));
}

/** Write a SKILL.md at `<root>/<relativeSkillDir>/SKILL.md`. */
async function writeSkill(root, relativeSkillDir, content) {
  const dir = join(root, relativeSkillDir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content);
}

describe("validateSkillFrontmatter", () => {
  it("accepts frontmatter with a name and a description", () => {
    const errors = validateSkillFrontmatter(
      skillDocument("name: example-skill\ndescription: Does a thing. Use when a thing needs doing."),
    );

    assert.deepEqual(errors, []);
  });

  it("reports unparseable YAML", () => {
    const errors = validateSkillFrontmatter(
      skillDocument("name: example-skill\ndescription: Use when the plan: breaks"),
    );

    assert.equal(errors.length, 1);
    assert.match(errors[0], /not valid YAML/);
  });

  it("reports a missing name", () => {
    const errors = validateSkillFrontmatter(skillDocument("description: Does a thing."));

    assert.deepEqual(errors, ["frontmatter is missing a non-empty name"]);
  });

  it("reports a missing description", () => {
    const errors = validateSkillFrontmatter(skillDocument("name: example-skill"));

    assert.deepEqual(errors, ["frontmatter is missing a non-empty description"]);
  });

  it("reports a description over the length limit", () => {
    const errors = validateSkillFrontmatter(
      skillDocument(`name: example-skill\ndescription: ${"a".repeat(MAX_DESCRIPTION_LENGTH + 1)}`),
    );

    assert.equal(errors.length, 1);
    assert.match(errors[0], /description exceeds 1024 characters \(1025\)/);
  });

  it("accepts a description exactly at the length limit", () => {
    const errors = validateSkillFrontmatter(
      skillDocument(`name: example-skill\ndescription: ${"a".repeat(MAX_DESCRIPTION_LENGTH)}`),
    );

    assert.deepEqual(errors, []);
  });

  it("reports a file with no frontmatter block", () => {
    const errors = validateSkillFrontmatter("# Skill body\n\nNo frontmatter here.\n");

    assert.deepEqual(errors, ["frontmatter block is missing (expected '---' delimiters)"]);
  });
});

describe("checkSkills", () => {
  it("reports each failing SKILL.md and counts every file it checked", async () => {
    const root = await makeFixtureRoot();
    try {
      await writeSkill(
        root,
        "skills/good",
        skillDocument("name: good-skill\ndescription: Does a thing. Use when testing the checker."),
      );
      await writeSkill(
        root,
        "skills/broken",
        skillDocument("name: broken-skill\ndescription: Use when the plan: breaks"),
      );

      const result = await checkSkills({ root });

      assert.equal(result.checked, 2);
      assert.equal(result.failures.length, 1);
      assert.equal(result.failures[0].file, join("skills", "broken", "SKILL.md"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores markdown files that are not SKILL.md", async () => {
    const root = await makeFixtureRoot();
    try {
      await writeSkill(root, "skills/good", skillDocument("name: good-skill\ndescription: Does a thing."));
      await writeFile(join(root, "skills", "good", "REFERENCE.md"), "---\nnot: a skill\n---\n");

      const result = await checkSkills({ root });

      assert.equal(result.checked, 1);
      assert.deepEqual(result.failures, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes on this repository's own skills tree", async () => {
    const result = await checkSkills({ root: REPO_ROOT });

    assert.deepEqual(result.failures, []);
    assert.ok(result.checked > 0, "expected the check to find SKILL.md files");
  });
});
