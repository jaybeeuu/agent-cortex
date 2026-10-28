// Tests for the legacy sweep step of `agent-cortex install pi`: the
// pre-staged-model installer wrote rendered agents and skill copies into pi's
// own user directories (~/.pi/agent/…). Now that the staged package is the
// single source, those copies are stale — two sources of the same skill is the
// collision diagnostic the staged model exists to remove.
//
// The sweep is a one-shot MIGRATION, not a standing rule: it attributes by name
// from the package root, so a same-name file is indistinguishable from a
// rendered copy — which is only acceptable once, and is why it records that it
// ran and never runs again. pi's extensions directory is never touched: no
// installer ever wrote there, so anything in it is the user's.
//
// Every test runs against a throwaway tree: `root` stands in for the package
// root (what this package still ships), `piUserDir` for pi's own user directory
// seeded with the old flow's copies plus entries of the user's own.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readdir, stat, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sweepLegacyPiUserDirs } from "../bin/installers/pi.mjs";
import { makeFakePi } from "./helpers/fake-pi.mjs";

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "agent-cortex.mjs");

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI_PATH, ...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) =>
      resolve({ exitCode: error ? (error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function makeTmp() {
  return mkdtemp(join(tmpdir(), "pi-sweep-"));
}

/** Write a `{ relativePath: content }` map below `baseDir`. */
async function writeFiles(baseDir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(baseDir, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
}

/**
 * A throwaway package root plus pi's user directory, seeded with what the old
 * flow left behind: rendered agents (including the orphaned pipeline-worker),
 * skill copies inside the package's own skill groups, and copied extensions —
 * alongside an agent, a skill, and an extension of the user's own.
 */
async function makeSweepTree() {
  const home = await makeTmp();
  const root = join(home, "package-root");
  const piUserDir = join(home, ".pi", "agent");

  await writeFiles(root, {
    "skills/engineering/tdd/SKILL.md": "---\nname: tdd\n---\n\nBody.\n",
    "skills/workflow/ralph/SKILL.md": "---\nname: ralph\n---\n\nBody.\n",
    "agents/plan/agent.md": "# plan\n",
    "extensions/skill-stats/index.ts": "export default () => {};\n",
  });

  await writeFiles(piUserDir, {
    "settings.json": "{}\n",
    ".agent-cortex-install.json": `${JSON.stringify({ agents: ["plan.agent.md"], skills: ["workflow/ralph/SKILL.md"] })}\n`,
    "agents/plan.agent.md": '---\nname: "agent-cortex:plan"\n---\n\n# plan\n',
    "agents/pipeline-worker.agent.md": '---\nname: "pipeline-worker"\n---\n',
    "agents/mine.agent.md": '---\nname: "mine"\n---\n\n# my agent\n',
    "skills/workflow/ralph/SKILL.md": "---\nname: ralph\n---\n\nBody.\n",
    "skills/productivity/migration/SKILL.md": "---\nname: migration\n---\n\nBody.\n",
    "skills/mine/SKILL.md": "---\nname: mine\n---\n\nBody.\n",
    "extensions/skill-stats/index.ts": "export default () => {};\n",
    "extensions/mine/index.ts": "export default () => {};\n",
  });

  return {
    home,
    root,
    piUserDir,
    // The migration record lives outside pi's user directory, under the home
    // install root (~/.agent-cortex) — never inside the directory it describes.
    recordPath: join(home, ".agent-cortex", "legacy-sweep.json"),
    path: (rel) => join(piUserDir, rel),
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}

/** Sweep the throwaway pi user directory, recording the migration outside it. */
function sweepTree(tree, options = {}) {
  return sweepLegacyPiUserDirs({
    root: tree.root,
    piUserDir: tree.piUserDir,
    recordPath: tree.recordPath,
    warn: () => {},
    ...options,
  });
}

// ─── sweepLegacyPiUserDirs ───────────────────────────────────────────────────

describe("sweepLegacyPiUserDirs — agents", () => {
  it("removes the rendered agent copies and the orphan the old flow shipped, keeping the user's own agent", async () => {
    const tree = await makeSweepTree();
    try {
      const result = await sweepTree(tree);

      assert.equal(await pathExists(tree.path("agents/plan.agent.md")), false, "rendered copy removed");
      assert.equal(await pathExists(tree.path("agents/pipeline-worker.agent.md")), false, "orphan removed");
      assert.equal(await pathExists(tree.path("agents/mine.agent.md")), true, "user agent kept");
      assert.ok(result.removed.includes(tree.path("agents/plan.agent.md")));
      assert.ok(result.kept.includes(tree.path("agents/mine.agent.md")));
    } finally {
      await tree.cleanup();
    }
  });
});

// The migration attributes by name, so a copy the user wrote under a name this
// package ships is indistinguishable from a rendered one. That is accepted for
// a single run and is exactly why the sweep is one-shot.
describe("sweepLegacyPiUserDirs — a user's copy of a shipped name", () => {
  it("removes both a hand-written agent and an edited skill copy in the single migration", async () => {
    const tree = await makeSweepTree();
    try {
      await writeFiles(tree.piUserDir, {
        // No GENERATED marker: written by the user, not rendered by an install.
        "agents/plan.agent.md": '---\nname: "my-plan"\n---\n\n# my own plan\n',
        // Edited after the install that rendered it.
        "skills/workflow/ralph/SKILL.md": "---\nname: ralph\n---\n\nMy own edits.\n",
      });

      await sweepTree(tree);

      assert.equal(await pathExists(tree.path("agents/plan.agent.md")), false);
      assert.equal(await pathExists(tree.path("skills/workflow/ralph")), false);
    } finally {
      await tree.cleanup();
    }
  });

  it("keeps a same-name agent and skill written after the migration", async () => {
    const tree = await makeSweepTree();
    try {
      await sweepTree(tree);
      await writeFiles(tree.piUserDir, {
        "agents/plan.agent.md": '---\nname: "my-plan"\n---\n\n# my own plan\n',
        "skills/workflow/ralph/SKILL.md": "---\nname: ralph\n---\n\nMy own ralph.\n",
      });

      const second = await sweepTree(tree);

      assert.deepEqual(second.removed, []);
      assert.equal(await pathExists(tree.path("agents/plan.agent.md")), true);
      assert.equal(await pathExists(tree.path("skills/workflow/ralph/SKILL.md")), true);
    } finally {
      await tree.cleanup();
    }
  });
});

describe("sweepLegacyPiUserDirs — skills", () => {
  it("removes the skill copies inside the package's skill groups — including one it no longer ships — and keeps a skill of the user's own", async () => {
    const tree = await makeSweepTree();
    try {
      await sweepTree(tree);

      assert.equal(await pathExists(tree.path("skills/workflow/ralph")), false, "rendered copy removed");
      assert.equal(
        await pathExists(tree.path("skills/productivity/migration")),
        false,
        "copy of a skill this package no longer ships removed",
      );
      assert.equal(await pathExists(tree.path("skills/mine/SKILL.md")), true, "user skill kept");
    } finally {
      await tree.cleanup();
    }
  });

  it("removes the skill-group directories it empties, leaving the ones that still hold a user's skill", async () => {
    const tree = await makeSweepTree();
    try {
      await writeFiles(tree.piUserDir, { "skills/workflow/mine/SKILL.md": "---\nname: mine\n---\n" });

      await sweepTree(tree);

      assert.equal(await pathExists(tree.path("skills/productivity")), false, "emptied group dir removed");
      assert.equal(await pathExists(tree.path("skills/workflow")), true, "group dir holding a user skill kept");
    } finally {
      await tree.cleanup();
    }
  });

  it("leaves a group directory that was already empty alone", async () => {
    const tree = await makeSweepTree();
    try {
      await mkdir(tree.path("skills/planning"), { recursive: true });

      await sweepTree(tree);

      assert.equal(await pathExists(tree.path("skills/planning")), true, "a directory this sweep did not empty stays");
    } finally {
      await tree.cleanup();
    }
  });

  it("does not follow a symlinked skill group out of pi's user directory", async () => {
    const tree = await makeSweepTree();
    try {
      await writeFiles(tree.home, { "shared-skills/ralph/SKILL.md": "---\nname: ralph\n---\n\nBody.\n" });
      await rm(tree.path("skills/workflow"), { recursive: true, force: true });
      await symlink(join(tree.home, "shared-skills"), tree.path("skills/workflow"), "dir");

      await sweepTree(tree);

      assert.equal(await pathExists(join(tree.home, "shared-skills/ralph/SKILL.md")), true, "link target untouched");
      assert.equal(await pathExists(tree.path("skills/workflow")), true, "the link itself stays");
    } finally {
      await tree.cleanup();
    }
  });
});

// No agent-cortex installer has ever written into pi's extensions directory —
// this repo's own extension READMEs tell users to put the shipped names there —
// so the directory holds only user state and the sweep does not enter it.
describe("sweepLegacyPiUserDirs — extensions", () => {
  it("never touches pi's extensions directory, not even a copy of a shipped extension", async () => {
    const tree = await makeSweepTree();
    try {
      const result = await sweepTree(tree);

      assert.equal(await pathExists(tree.path("extensions/skill-stats/index.ts")), true, "shipped name kept");
      assert.equal(await pathExists(tree.path("extensions/mine/index.ts")), true, "user extension kept");
      assert.equal(result.removed.some((path) => path.includes("extensions")), false, "nothing reported in that tree");
    } finally {
      await tree.cleanup();
    }
  });
});

describe("sweepLegacyPiUserDirs — run modes", () => {
  it("reports the removals without deleting anything on a dry run", async () => {
    const tree = await makeSweepTree();
    try {
      const result = await sweepTree(tree, { dryRun: true });

      assert.ok(result.removed.includes(tree.path("agents/plan.agent.md")));
      assert.ok(result.removed.includes(tree.path("skills/workflow/ralph")));
      assert.equal(await pathExists(tree.path("agents/plan.agent.md")), true, "nothing deleted");
      assert.equal(await pathExists(tree.path("skills/workflow/ralph")), true, "nothing deleted");
      assert.equal(result.removed.includes(tree.path("extensions/skill-stats")), false);
    } finally {
      await tree.cleanup();
    }
  });

  it("writes nothing and records nothing on a dry run", async () => {
    const tree = await makeSweepTree();
    try {
      await sweepTree(tree, { dryRun: true });

      assert.equal(await pathExists(tree.recordPath), false);
    } finally {
      await tree.cleanup();
    }
  });

  it("leaves pi's own user directory alone when nothing was written there", async () => {
    const home = await makeTmp();
    try {
      const result = await sweepLegacyPiUserDirs({
        root: join(home, "package-root"),
        piUserDir: join(home, "absent"),
        recordPath: join(home, ".agent-cortex", "legacy-sweep.json"),
        warn: () => {},
      });

      assert.deepEqual(result.removed, []);
      assert.deepEqual(await readdir(home), [], "nothing created");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// The record is what makes the sweep one-shot, so it must live outside the
// directory it describes (~/.pi/agent may hold no agent-cortex artifact after
// the migration) and must only claim a migration that actually finished.
describe("sweepLegacyPiUserDirs — the migration record", () => {
  it("records the migration outside pi's user directory, leaving no agent-cortex artifact in it", async () => {
    const tree = await makeSweepTree();
    try {
      await sweepTree(tree);

      assert.equal(
        await pathExists(tree.path(".agent-cortex-legacy-sweep.json")),
        false,
        "nothing is written into pi's user directory",
      );
      assert.equal(await pathExists(tree.recordPath), true, "the migration is recorded outside it");
      assert.equal(await pathExists(tree.path("agents/mine.agent.md")), true, "the user's own agent is untouched");
    } finally {
      await tree.cleanup();
    }
  });

  it("gates per pi user directory, so a second directory still migrates once", async () => {
    const tree = await makeSweepTree();
    try {
      await sweepTree(tree);
      const otherPiUserDir = join(tree.home, "other-pi", "agent");
      await writeFiles(otherPiUserDir, { "agents/plan.agent.md": '---\nname: "agent-cortex:plan"\n---\n' });

      const other = await sweepLegacyPiUserDirs({
        root: tree.root,
        piUserDir: otherPiUserDir,
        recordPath: tree.recordPath,
        warn: () => {},
      });

      assert.deepEqual(other.removed, [join(otherPiUserDir, "agents", "plan.agent.md")]);
      assert.deepEqual((await sweepTree(tree)).removed, [], "the first directory stays migrated");
    } finally {
      await tree.cleanup();
    }
  });

  it("does not re-run the migration when the record cannot be read", async () => {
    const tree = await makeSweepTree();
    try {
      await writeFiles(tree.home, { ".agent-cortex/legacy-sweep.json": "{ not json" });

      const result = await sweepTree(tree);

      assert.deepEqual(result.removed, [], "an ambiguous record never deletes");
      assert.equal(await pathExists(tree.path("agents/plan.agent.md")), true);
    } finally {
      await tree.cleanup();
    }
  });

  it("warns instead of failing when the record cannot be written", async () => {
    const tree = await makeSweepTree();
    const recordDir = dirname(tree.recordPath);
    const warnings = [];
    try {
      await mkdir(recordDir, { recursive: true });
      await chmod(recordDir, 0o555);

      const result = await sweepTree(tree, { warn: (msg) => warnings.push(msg) });

      assert.ok(result.removed.includes(tree.path("agents/plan.agent.md")), "the migration still ran");
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0].includes(tree.recordPath), "the warning names the record that could not be written");
    } finally {
      await chmod(recordDir, 0o755);
      await tree.cleanup();
    }
  });

  it("records nothing when an artifact could not be removed, and retries the remainder on the next install", async () => {
    const tree = await makeSweepTree();
    const blockedGroup = tree.path("skills/workflow");
    try {
      await chmod(blockedGroup, 0o555);
      await sweepTree(tree);

      assert.equal(await pathExists(tree.path("skills/workflow/ralph")), true, "the copy survived");
      assert.equal(await pathExists(tree.recordPath), false, "an incomplete migration is not recorded");
    } finally {
      await chmod(blockedGroup, 0o755);
    }
    try {
      await sweepTree(tree);

      assert.equal(await pathExists(tree.path("skills/workflow/ralph")), false, "the retry removes the remainder");
      assert.equal(await pathExists(tree.recordPath), true, "the completed migration is recorded");
    } finally {
      await tree.cleanup();
    }
  });
});

// A directory the sweep cannot read is not an empty one. These tests make a
// directory unreadable (mode 000, the leftover-sudo shape) and assert the sweep
// refuses to record the migration it could not complete, so the next install
// retries once the permissions allow it. Root ignores file modes, so they skip
// when the suite runs as root.
const skipAsRoot = process.getuid?.() === 0 ? "file modes do not restrict root" : false;

describe("sweepLegacyPiUserDirs — a directory the sweep cannot read", () => {
  it("does not record the migration when a skill group cannot be listed, and retries once it can", { skip: skipAsRoot }, async () => {
    const tree = await makeSweepTree();
    const blockedGroup = tree.path("skills/workflow");
    const warnings = [];
    try {
      await chmod(blockedGroup, 0o000);
      await sweepTree(tree, { warn: (msg) => warnings.push(msg) });
    } finally {
      await chmod(blockedGroup, 0o755);
    }
    try {
      assert.equal(await pathExists(tree.path("skills/workflow/ralph")), true, "the copy it could not see survived");
      assert.equal(await pathExists(tree.recordPath), false, "a migration that could not list is not recorded");
      assert.ok(
        warnings.some((warning) => warning.includes(blockedGroup)),
        "the warning names the directory it could not list",
      );

      await sweepTree(tree);

      assert.equal(await pathExists(tree.path("skills/workflow/ralph")), false, "the retry removes the copy");
      assert.equal(await pathExists(tree.recordPath), true, "the completed migration is recorded");
    } finally {
      await tree.cleanup();
    }
  });

  it("does not record the migration when pi's skills directory cannot be listed", { skip: skipAsRoot }, async () => {
    const tree = await makeSweepTree();
    const skillsDir = tree.path("skills");
    const warnings = [];
    try {
      await chmod(skillsDir, 0o000);
      await sweepTree(tree, { warn: (msg) => warnings.push(msg) });
    } finally {
      await chmod(skillsDir, 0o755);
    }
    try {
      assert.equal(await pathExists(tree.path("skills/workflow/ralph/SKILL.md")), true, "the copies survived");
      assert.equal(await pathExists(tree.recordPath), false, "a migration that could not list is not recorded");
      assert.ok(
        warnings.some((warning) => warning.includes(skillsDir)),
        "the warning names the directory it could not list",
      );
    } finally {
      await tree.cleanup();
    }
  });

  it("does not record the migration when pi's agents directory cannot be listed", { skip: skipAsRoot }, async () => {
    const tree = await makeSweepTree();
    const agentsDir = tree.path("agents");
    const warnings = [];
    try {
      await chmod(agentsDir, 0o000);
      await sweepTree(tree, { warn: (msg) => warnings.push(msg) });
    } finally {
      await chmod(agentsDir, 0o755);
    }
    try {
      assert.equal(await pathExists(tree.path("agents/plan.agent.md")), true, "the copy it could not see survived");
      assert.equal(await pathExists(tree.recordPath), false, "a migration that could not list is not recorded");
      assert.ok(
        warnings.some((warning) => warning.includes(agentsDir)),
        "the warning names the directory it could not list",
      );
    } finally {
      await tree.cleanup();
    }
  });

  it("does not record the migration when the package root cannot be listed", { skip: skipAsRoot }, async () => {
    const tree = await makeSweepTree();
    const shippedSkills = join(tree.root, "skills");
    const warnings = [];
    try {
      await chmod(shippedSkills, 0o000);
      await sweepTree(tree, { warn: (msg) => warnings.push(msg) });
    } finally {
      await chmod(shippedSkills, 0o755);
    }
    try {
      assert.equal(
        await pathExists(tree.path("skills/workflow/ralph")),
        true,
        "nothing is removed while attribution is unavailable",
      );
      assert.equal(await pathExists(tree.recordPath), false, "a migration that could not attribute is not recorded");
      assert.ok(
        warnings.some((warning) => warning.includes(shippedSkills)),
        "the warning names the package-root directory it could not list",
      );
    } finally {
      await tree.cleanup();
    }
  });
});

describe("sweepLegacyPiUserDirs — the path record left in pi's user directory", () => {
  it("removes a stale `.agent-cortex-install.json` along with the copies it lists, and leaves pi's config alone", async () => {
    const tree = await makeSweepTree();
    try {
      await sweepTree(tree);

      assert.equal(await pathExists(tree.path(".agent-cortex-install.json")), false, "stale record removed");
      assert.equal(await pathExists(tree.path("settings.json")), true, "pi's config untouched");
    } finally {
      await tree.cleanup();
    }
  });
});

// ─── CLI wiring ──────────────────────────────────────────────────────────────

/** Seed pi's user directory inside a fake HOME with two legacy artifacts. */
async function seedLegacyArtifacts(home) {
  await writeFiles(join(home, ".pi", "agent"), {
    "agents/pipeline-worker.agent.md": '---\nname: "pipeline-worker"\n---\n',
    "skills/workflow/ralph/SKILL.md": "---\nname: ralph\n---\n\nBody.\n",
  });
}

describe("install pi CLI: legacy sweep", () => {
  it("sweeps the old artifacts once the staged package is registered", async () => {
    const home = await makeTmp();
    const bin = await makeTmp();
    try {
      await makeFakePi(bin);
      await seedLegacyArtifacts(home);

      const { exitCode } = await runCli(["install", "pi"], { HOME: home, PATH: `${bin}:${process.env.PATH}` });

      assert.equal(exitCode, 0);
      assert.equal(await pathExists(join(home, ".pi", "agent", "agents", "pipeline-worker.agent.md")), false);
      assert.equal(await pathExists(join(home, ".pi", "agent", "skills", "workflow", "ralph")), false);
      assert.equal(
        await pathExists(join(home, ".agent-cortex", "pi", "skills", "workflow", "ralph", "SKILL.md")),
        true,
        "the staged package carries the skill",
      );
      assert.equal(
        await pathExists(join(home, ".pi", "agent", ".agent-cortex-legacy-sweep.json")),
        false,
        "pi's user directory holds no agent-cortex artifact after the migration",
      );
      assert.equal(
        await pathExists(join(home, ".agent-cortex", "legacy-sweep.json")),
        true,
        "the migration is recorded under the home install root",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(bin, { recursive: true, force: true });
    }
  });

  it("does not sweep a same-name artifact the user writes after that first migration", async () => {
    const home = await makeTmp();
    const bin = await makeTmp();
    try {
      await makeFakePi(bin);
      await seedLegacyArtifacts(home);
      const env = { HOME: home, PATH: `${bin}:${process.env.PATH}` };
      await runCli(["install", "pi"], env);
      await writeFiles(join(home, ".pi", "agent"), {
        "agents/pipeline-worker.agent.md": '---\nname: "mine"\n---\n',
        "skills/workflow/ralph/SKILL.md": "---\nname: mine\n---\n",
      });

      const { exitCode } = await runCli(["install", "pi"], env);

      assert.equal(exitCode, 0);
      assert.equal(await pathExists(join(home, ".pi", "agent", "agents", "pipeline-worker.agent.md")), true);
      assert.equal(await pathExists(join(home, ".pi", "agent", "skills", "workflow", "ralph")), true);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(bin, { recursive: true, force: true });
    }
  });

  it("keeps the old artifacts when the staged package could not be registered", async () => {
    const home = await makeTmp();
    try {
      await seedLegacyArtifacts(home);

      const { exitCode } = await runCli(["install", "pi"], { HOME: home, PATH: "/nonexistent" });

      assert.equal(exitCode, 0);
      assert.equal(
        await pathExists(join(home, ".pi", "agent", "skills", "workflow", "ralph")),
        true,
        "nothing swept while the staged package is not registered",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("keeps the old artifacts on the stage-only form", async () => {
    const home = await makeTmp();
    const out = await makeTmp();
    try {
      await seedLegacyArtifacts(home);

      const { exitCode } = await runCli(["install", "pi", "--output", out], { HOME: home });

      assert.equal(exitCode, 0);
      assert.equal(await pathExists(join(home, ".pi", "agent", "agents", "pipeline-worker.agent.md")), true);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });
});
