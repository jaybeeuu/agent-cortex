import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  describeClaudeArtifacts,
  describePiArtifacts,
  formatHarnessTable,
  formatUpdateFlags,
  formatUpdateReport,
  parseHarnessSelection,
  promptHarnessSelection,
  runUpdate,
  selectHarnesses,
} from "../lib/harness-update.mjs";
import { writeFingerprint } from "./helpers/harness-fingerprint.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";

const tempRoot = createTempRoot("agent-cortex-update-");

/**
 * One harness status, with the fields the case does not care about defaulted.
 * @param {{ harness: string, installed?: string | null, cli?: string,
 *           staleness?: "current" | "stale" | "ahead" | "unknown" | "missing" }} overrides
 * @returns {import("../lib/harness-versions.mjs").HarnessStatus}
 */
function createStatus({ harness, installed = null, cli = "2.5.1", staleness = "missing" }) {
  return { harness, installed, cli, staleness };
}

/** @returns {Promise<string>} A fake home directory with an existing root. */
async function createHome() {
  const home = join(await tempRoot.createWorkspace(), "home");
  await mkdir(home, { recursive: true });
  return home;
}

/**
 * One claude installer result, with the artifacts the case does not count defaulted.
 * @param {Partial<import("../bin/installers/claude.mjs").InstallClaudeResult>} [overrides]
 * @returns {import("../bin/installers/claude.mjs").InstallClaudeResult}
 */
function createClaudeResult(overrides = {}) {
  return {
    output: "/home/.agent-cortex/claude",
    marketplaceRoot: "/home/.agent-cortex",
    manifestPath: "/home/.agent-cortex/.claude-plugin/marketplace.json",
    marketplaceManifest: {},
    agents: ["plan", "ralph"],
    skills: { names: ["tdd", "grill-me"], md: 5, files: 7, dir: "/home/.agent-cortex/claude/skills" },
    hooks: true,
    hookFiles: ["notify.mjs"],
    handAuthored: [".mcp.json"],
    settings: { path: "/home/.claude/settings.json", action: "written", removedSymlink: false },
    instructions: { path: "/home/.claude/CLAUDE.md", action: "written", removedSymlink: false },
    pluginVersion: "2.5.1",
    warnings: [],
    dryRun: false,
    ...overrides,
  };
}

/**
 * One pi installer result, with the artifacts the case does not count defaulted.
 * @param {Partial<import("../bin/installers/pi.mjs").InstallPiResult>} [overrides]
 * @returns {import("../bin/installers/pi.mjs").InstallPiResult}
 */
function createPiResult(overrides = {}) {
  return {
    output: "/home/.agent-cortex/pi",
    agents: [{ name: "ralph", filePath: "/home/.agent-cortex/pi/agents/ralph.agent.md" }],
    skills: { skills: 34, md: 72, files: 90, dir: "/home/.agent-cortex/pi/skills" },
    extensions: { files: 60, dir: "/home/.agent-cortex/pi/extensions" },
    packages: {
      dir: "/home/.agent-cortex/pi/node_modules",
      bundled: ["pi-questions"],
      staged: ["pi-questions"],
      resources: { extensions: [], skills: [] },
    },
    manifest: {
      path: "/home/.agent-cortex/pi/package.json",
      manifest: {
        "//": "generated",
        name: "agent-cortex-pi",
        version: "2.5.1",
        private: true,
        description: "staged",
        type: "module",
        keywords: ["pi-package"],
        pi: { extensions: ["./extensions"], skills: ["./skills"] },
      },
    },
    tokenMap: "/home/token-map.json",
    warnings: [],
    dryRun: false,
    ...overrides,
  };
}

describe("selectHarnesses", () => {
  it("targets only the harnesses named on the command line", async () => {
    const statuses = [
      createStatus({ harness: "claude", installed: "2.4.0", staleness: "stale" }),
      createStatus({ harness: "pi", installed: "2.5.1", staleness: "current" }),
    ];

    const plan = selectHarnesses({ statuses, harnesses: ["claude"] });

    assert.deepEqual(
      plan.targets.map((entry) => entry.harness),
      ["claude"],
    );
    assert.deepEqual(
      plan.skipped.map((entry) => entry.harness),
      ["pi"],
    );
  });

  it("targets a named harness even when its version is current", async () => {
    const statuses = [createStatus({ harness: "claude", installed: "2.5.1", staleness: "current" })];

    const plan = selectHarnesses({ statuses, harnesses: ["claude"] });

    assert.deepEqual(
      plan.targets.map((entry) => entry.harness),
      ["claude"],
      "an explicit name is a request to re-run that installer",
    );
  });

  it("reports a name that is not a supported harness instead of targeting it", async () => {
    const statuses = [createStatus({ harness: "claude", installed: "2.4.0", staleness: "stale" })];

    const plan = selectHarnesses({ statuses, harnesses: ["docker", "claude"] });

    assert.deepEqual(plan.unknown, ["docker"]);
    assert.deepEqual(
      plan.targets.map((entry) => entry.harness),
      ["claude"],
    );
  });

  it("targets every harness that is not at the CLI version for --all", async () => {
    const statuses = [
      createStatus({ harness: "claude", installed: "2.5.1", staleness: "current" }),
      createStatus({ harness: "pi", installed: "2.4.0", staleness: "stale" }),
    ];

    const plan = selectHarnesses({ statuses, all: true });

    assert.deepEqual(
      plan.targets.map((entry) => entry.harness),
      ["pi"],
    );
    assert.deepEqual(
      plan.skipped.map((entry) => entry.harness),
      ["claude"],
    );
  });

  it("targets a missing harness for --all, because it is not at the CLI version", async () => {
    const statuses = [createStatus({ harness: "pi" })];

    const plan = selectHarnesses({ statuses, all: true });

    assert.deepEqual(
      plan.targets.map((entry) => entry.harness),
      ["pi"],
    );
  });

  it("targets every harness for --all --force, current ones included", async () => {
    const statuses = [
      createStatus({ harness: "claude", installed: "2.5.1", staleness: "current" }),
      createStatus({ harness: "pi", installed: "2.5.1", staleness: "current" }),
    ];

    const plan = selectHarnesses({ statuses, all: true, force: true });

    assert.deepEqual(
      plan.targets.map((entry) => entry.harness),
      ["claude", "pi"],
    );
    assert.deepEqual(plan.skipped, []);
  });

  it("targets nothing when there is no selection", async () => {
    const statuses = [createStatus({ harness: "pi", installed: "2.4.0", staleness: "stale" })];

    const plan = selectHarnesses({ statuses });

    assert.deepEqual(plan.targets, []);
    assert.deepEqual(plan.unknown, []);
  });
});

describe("runUpdate", () => {
  it("refreshes only the targets and reports previous and new versions with their artifacts", async () => {
    const home = await createHome();
    await writeFingerprint(home, "claude", JSON.stringify({ version: "2.4.0" }));
    await writeFingerprint(home, "pi", JSON.stringify({ version: "2.4.0" }));
    /** @type {string[]} */
    const refreshed = [];

    const entries = await runUpdate({
      cli: "2.5.1",
      home,
      targets: [createStatus({ harness: "claude", installed: "2.4.0", staleness: "stale" })],
      refresh: async (harness) => {
        refreshed.push(harness);
        await writeFingerprint(home, "claude", JSON.stringify({ version: "2.5.1" }));
        return ["agents (4 files)"];
      },
    });

    assert.deepEqual(refreshed, ["claude"], "the pi installer never runs");
    assert.deepEqual(entries, [
      { harness: "claude", previous: "2.4.0", next: "2.5.1", artifacts: ["agents (4 files)"] },
    ]);
  });

  it("reports a harness with no artifact root as not installed", async () => {
    const home = await createHome();

    const entries = await runUpdate({
      cli: "2.5.1",
      home,
      targets: [createStatus({ harness: "pi" })],
      refresh: async () => {
        await writeFingerprint(home, "pi", JSON.stringify({ version: "2.5.1" }));
        return ["package manifest (version 2.5.1)"];
      },
    });

    assert.deepEqual(entries, [
      { harness: "pi", previous: "not installed", next: "2.5.1", artifacts: ["package manifest (version 2.5.1)"] },
    ]);
  });

  it("reports an unknown new version when the installer left no readable fingerprint", async () => {
    const home = await createHome();
    await writeFingerprint(home, "pi", JSON.stringify({ version: "2.4.0" }));

    const entries = await runUpdate({
      cli: "2.5.1",
      home,
      targets: [createStatus({ harness: "pi", installed: "2.4.0", staleness: "stale" })],
      refresh: async () => {
        await writeFingerprint(home, "pi", "{ not json");
        return ["package manifest (version 2.5.1)"];
      },
    });

    assert.equal(entries[0].next, "unknown");
  });
});

describe("describePiArtifacts", () => {
  it("reports the counts and versions the pi installer wrote", async () => {
    assert.deepEqual(describePiArtifacts(createPiResult()), [
      "agents (1 file)",
      "skills (34 skills, 72 markdown files)",
      "extensions (60 files)",
      "bundled pi packages (pi-questions)",
      "package manifest (version 2.5.1)",
    ]);
  });
});

describe("describeClaudeArtifacts", () => {
  it("reports the counts, the plugin version, and the state the install left each artifact in", async () => {
    assert.deepEqual(describeClaudeArtifacts(createClaudeResult()), [
      "agents (2 files)",
      "skills (2 skills, 5 markdown files)",
      "hooks (1 file)",
      "hand-authored extras (1 file)",
      "plugin manifest (version 2.5.1)",
      "settings (written)",
      "instructions (written)",
    ]);
  });

  it("reports the user config as not written when the install generated only", async () => {
    const artifacts = describeClaudeArtifacts(createClaudeResult({ settings: null, instructions: null }));

    assert.deepEqual(artifacts.slice(-2), ["settings (not written)", "instructions (not written)"]);
  });
});

describe("formatHarnessTable", () => {
  it("lists every harness with its installed version, the CLI version, and its status", async () => {
    const statuses = [
      createStatus({ harness: "claude", installed: "2.4.0", staleness: "stale" }),
      createStatus({ harness: "pi" }),
    ];

    const table = formatHarnessTable(statuses);

    assert.deepEqual(table.split("\n"), [
      "harness  installed      cli    status",
      "claude   2.4.0          2.5.1  stale",
      "pi       not installed  2.5.1  missing",
    ]);
  });
});

describe("formatUpdateFlags", () => {
  it("names the three ways to select harnesses, with the invoked command name", async () => {
    const text = formatUpdateFlags("ctx");

    for (const expected of ["ctx update <harness>...", "ctx update -a", "ctx update -a -f"]) {
      assert.ok(text.includes(expected), `the flags list documents "${expected}"`);
    }
  });
});

describe("formatUpdateReport", () => {
  it("prints one block per refreshed harness with its version change and artifacts", async () => {
    const text = formatUpdateReport({
      cli: "2.5.1",
      entries: [
        { harness: "claude", previous: "2.4.0", next: "2.5.1", artifacts: ["agents (4 files)", "skills (30 skills)"] },
        { harness: "pi", previous: "2.5.1", next: "2.5.1", artifacts: ["extensions (14 files)"] },
      ],
    });

    assert.deepEqual(text.split("\n"), [
      "claude 2.4.0 → 2.5.1",
      "  ✓ agents (4 files)",
      "  ✓ skills (30 skills)",
      "pi 2.5.1 → 2.5.1",
      "  ✓ extensions (14 files)",
    ]);
  });

  it("names the harnesses left alone and the CLI version they already match", async () => {
    const text = formatUpdateReport({
      cli: "2.5.1",
      entries: [{ harness: "claude", previous: "2.4.0", next: "2.5.1", artifacts: ["agents (4 files)"] }],
      skipped: [createStatus({ harness: "pi", installed: "2.5.1", staleness: "current" })],
    });

    assert.equal(text.split("\n").at(-1), "Skipped (already at 2.5.1): pi");
  });

  it("prints a nothing-to-update line when every harness is current", async () => {
    const text = formatUpdateReport({
      cli: "2.5.1",
      entries: [],
      skipped: [
        createStatus({ harness: "claude", installed: "2.5.1", staleness: "current" }),
        createStatus({ harness: "pi", installed: "2.5.1", staleness: "current" }),
      ],
    });

    assert.equal(text, "Nothing to update — every harness is at 2.5.1.");
  });
});

describe("parseHarnessSelection", () => {
  const statuses = [
    createStatus({ harness: "claude", installed: "2.4.0", staleness: "stale" }),
    createStatus({ harness: "pi", installed: "2.5.1", staleness: "current" }),
  ];

  it("maps numbers to the harnesses on the matching rows", async () => {
    assert.deepEqual(parseHarnessSelection("2", statuses), ["pi"]);
    assert.deepEqual(parseHarnessSelection("1, 2", statuses), ["claude", "pi"]);
  });

  it("selects every harness for 'a'", async () => {
    assert.deepEqual(parseHarnessSelection("a", statuses), ["claude", "pi"]);
  });

  it("selects nothing for a blank answer", async () => {
    assert.deepEqual(parseHarnessSelection("  ", statuses), []);
  });

  it("rejects a number that is not on the list", async () => {
    assert.throws(() => parseHarnessSelection("3", statuses), /Invalid selection "3"/);
  });
});

describe("promptHarnessSelection", () => {
  it("prints the table and answers with the harnesses the numbers name", async () => {
    const statuses = [
      createStatus({ harness: "claude", installed: "2.4.0", staleness: "stale" }),
      createStatus({ harness: "pi", installed: "2.5.1", staleness: "current" }),
    ];
    const input = new PassThrough();
    const output = new PassThrough();

    const answer = promptHarnessSelection({ statuses, input, output });
    input.write("1\n");
    const chosen = await answer;

    assert.deepEqual(chosen, ["claude"]);
    assert.match(String(output.read()), /claude\s+2\.4\.0\s+2\.5\.1\s+stale/, "the prompt shows the table");
  });

  it("selects nothing when the input ends without an answer", async () => {
    const statuses = [createStatus({ harness: "pi", installed: "2.4.0", staleness: "stale" })];
    const input = new PassThrough();
    const output = new PassThrough();

    const answer = promptHarnessSelection({ statuses, input, output });
    input.end();

    assert.deepEqual(await answer, []);
  });
});
