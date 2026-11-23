// Tests for `ctx uninstall`: the selection rule, the settings-removal symmetry
// against the install-time merge, the idempotent no-op, and the two decisions
// the spec left open (the shared root survives, a ralph worktree is reported and
// left).
//
// Every test uses a temporary HOME — and a PATH holding only the fake harness
// CLIs plus node — so the developer's real ~/.agent-cortex, ~/.pi and ~/.claude
// are never read or written.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { PassThrough } from "node:stream";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { uninstallClaude } from "../bin/installers/claude.mjs";
import { uninstallPi } from "../bin/installers/pi.mjs";
import { parseArgs } from "../lib/cli.mjs";
import { promptHarnessSelection } from "../lib/harness-update.mjs";
import {
  findWorktrees,
  formatUninstallFlags,
  formatUninstallReport,
  installedHarnesses,
  parseConfirmation,
} from "../lib/harness-uninstall.mjs";
import { makeFakeClaude, registrationActions as registrationActionsOf, setFakeClaudeFailure } from "./helpers/fake-claude.mjs";
import { makeFakePi, setFakePiFailure } from "./helpers/fake-pi.mjs";
import { writeFingerprint } from "./helpers/harness-fingerprint.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "bin", "agent-cortex.mjs");
const tempRoot = createTempRoot("agent-cortex-uninstall-");
// Only the fake CLI directory, node, and the system defaults: a real `claude` or
// `pi` on the developer's PATH is never reachable from these tests.
const SYSTEM_PATH = [dirname(process.execPath), "/usr/bin", "/bin"].join(":");

/**
 * Run the CLI with a fake HOME.
 * @param {string[]} args
 * @param {{ env?: Record<string, string | undefined>, cwd?: string }} [options]
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
function runCli(args, { env = {}, cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { env: { ...process.env, ...env }, cwd },
      (error, stdout, stderr) => {
        resolve({ exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr });
      },
    );
  });
}

/** @param {string} path @returns {Promise<boolean>} */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every path below `dir` with its mtime, for "this wrote nothing" assertions.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function snapshot(dir) {
  const entries = (await readdir(dir, { recursive: true })).sort();
  return Promise.all(entries.map(async (entry) => `${entry} ${(await stat(join(dir, entry))).mtimeMs}`));
}

/** @returns {Promise<string>} A fake HOME with nothing installed. */
async function createHome() {
  const home = join(await tempRoot.createWorkspace(), "home");
  await mkdir(home, { recursive: true });
  return home;
}

/**
 * Stage a pi package where the installer puts it.
 * @param {string} home
 * @returns {Promise<string>} The staged package directory
 */
async function makeStagedPi(home) {
  const staged = join(home, ".agent-cortex", "pi");
  await mkdir(join(staged, "agents"), { recursive: true });
  await writeFile(
    join(staged, "package.json"),
    JSON.stringify({ name: "@jaybeeuu/agent-cortex-pi", version: "1.0.0" }, null, 2),
  );
  return staged;
}

/**
 * Write the marketplace manifest and plugin directory a Claude install leaves,
 * under a fake HOME. Mirrors the real layout: the marketplace root is
 * ~/.agent-cortex and the plugin lives at its ./claude source.
 * @param {string} home
 * @returns {Promise<{ output: string, marketplaceRoot: string, manifestPath: string }>}
 */
async function makeClaudeInstall(home) {
  const marketplaceRoot = join(home, ".agent-cortex");
  const output = join(marketplaceRoot, "claude");
  await mkdir(join(marketplaceRoot, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(marketplaceRoot, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "jaybeeuu",
      owner: { name: "tester" },
      plugins: [{ name: "agent-cortex", source: "./claude", description: "test plugin" }],
    }),
  );
  await mkdir(join(output, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(output, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "agent-cortex", version: "1.0.0", description: "test plugin" }),
  );
  return { output, marketplaceRoot, manifestPath: join(marketplaceRoot, ".claude-plugin", "marketplace.json") };
}

/**
 * Seed the fake Claude Code state with the registration an install makes.
 * @param {{ state: string }} fake
 * @param {{ marketplaceRoot: string }} install
 * @returns {Promise<void>}
 */
async function seedClaudeState(fake, { marketplaceRoot }) {
  await writeFile(
    fake.state,
    JSON.stringify({
      markets: [{ name: "jaybeeuu", path: marketplaceRoot }],
      installed: [{ id: "agent-cortex@jaybeeuu", version: "1.0.0" }],
    }),
  );
}

/** @param {string} log @returns {Promise<string[]>} */
async function callLines(log) {
  try {
    return (await readFile(log, "utf-8")).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * A fake Claude Code CLI in a directory that may not exist yet.
 * @param {string} dir
 * @returns {Promise<{ bin: string, log: string, state: string }>}
 */
async function makeClaudeCli(dir) {
  await mkdir(dir, { recursive: true });
  return makeFakeClaude(dir);
}

/**
 * A fake pi CLI whose settings file is the one the uninstall path reads
 * (~/.pi/agent/settings.json), so the fake's state and the installer's view agree.
 * @param {string} home
 * @param {string[]} packages
 * @returns {Promise<{ bin: string, log: string, settingsPath: string }>}
 */
async function makePiCli(home, packages) {
  const dir = join(home, ".pi", "agent");
  await mkdir(dir, { recursive: true });
  return makeFakePi(dir, { packages });
}

/** A realistic personal ~/.claude/settings.json plus the entries an install declares.
 * @returns {Record<string, any>} */
function settingsWithInstallEntries() {
  return {
    permissions: { allow: ["Bash(pnpm test:*)"] },
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo personal" }] }] },
    env: { PERSONAL_FLAG: "1" },
    enabledPlugins: { "agent-cortex@jaybeeuu": true, "personal@mine": true },
    extraKnownMarketplaces: {
      jaybeeuu: { source: { source: "github", repo: "me/agent-cortex" } },
      mine: { source: { source: "github", repo: "me/mine" } },
    },
  };
}

// ─── parseArgs ───────────────────────────────────────────────────────────────

describe("parseArgs uninstall", () => {
  it("returns the uninstall command with no selection for a bare run", async () => {
    assert.deepEqual(parseArgs(["uninstall"]), { command: "uninstall", harnesses: [], all: false, dryRun: false });
  });

  it("collects every named harness in order", async () => {
    assert.deepEqual(parseArgs(["uninstall", "pi", "claude"]), {
      command: "uninstall",
      harnesses: ["pi", "claude"],
      all: false,
      dryRun: false,
    });
  });

  it("parses --all and --dry-run", async () => {
    assert.deepEqual(parseArgs(["uninstall", "--all"]), { command: "uninstall", harnesses: [], all: true, dryRun: false });
    assert.deepEqual(parseArgs(["uninstall", "--dry-run"]), {
      command: "uninstall",
      harnesses: [],
      all: false,
      dryRun: true,
    });
  });

  it("rejects a harness name beside --all instead of resolving the contradiction", async () => {
    const parsed = parseArgs(["uninstall", "--all", "pi"]);
    assert.equal(parsed.command, "uninstall");
    assert.match(parsed.optionError ?? "", /cannot be combined/);
  });

  it("rejects an unknown option", async () => {
    const parsed = parseArgs(["uninstall", "--bogus"]);
    assert.equal(parsed.command, "uninstall");
    assert.match(parsed.optionError ?? "", /--bogus/);
  });
});

// ─── Selection and report ────────────────────────────────────────────────────

describe("installedHarnesses", () => {
  /** @type {import("../lib/harness-versions.mjs").HarnessStatus[]} */
  const statuses = [
    { harness: "claude", installed: "1.0.0", cli: "1.0.0", staleness: "current" },
    { harness: "pi", installed: null, cli: "1.0.0", staleness: "missing" },
  ];

  it("keeps only the harnesses with an install root", async () => {
    assert.deepEqual(
      installedHarnesses(statuses).map((status) => status.harness),
      ["claude"],
    );
  });

  it("counts an install whose version could not be read, because its files are there", async () => {
    /** @type {import("../lib/harness-versions.mjs").HarnessStatus[]} */
    const unreadable = [{ harness: "pi", installed: null, cli: "1.0.0", staleness: "unknown" }];
    assert.equal(installedHarnesses(unreadable).length, 1);
  });
});

describe("the selection prompt", () => {
  it("lists only installed harnesses, and a blank answer selects nothing", async () => {
    /** @type {import("../lib/harness-versions.mjs").HarnessStatus[]} */
    const statuses = [
      { harness: "claude", installed: "1.0.0", cli: "1.0.0", staleness: "current" },
      { harness: "pi", installed: null, cli: "1.0.0", staleness: "missing" },
    ];
    const input = new PassThrough();
    const output = new PassThrough();

    const answer = promptHarnessSelection({ statuses: installedHarnesses(statuses), input, output });
    input.write("\n");
    const chosen = await answer;

    assert.deepEqual(chosen, [], "a blank answer cancels and changes nothing");
    const table = String(output.read());
    assert.match(table, /^claude\s+1\.0\.0/m, "the installed harness is a row");
    assert.doesNotMatch(table, /^pi\b/m, "the harness that was never installed is not a row");
  });
});

describe("formatUninstallFlags", () => {
  it("names the ways to select without a prompt, with the invoked command name", async () => {
    const text = formatUninstallFlags("ctx");
    assert.match(text, /ctx uninstall <harness>\.\.\./);
    assert.match(text, /ctx uninstall --all/);
    assert.match(text, /ctx uninstall --dry-run/);
  });
});

describe("findWorktrees", () => {  it("lists the worktree directories below .agent-cortex/worktrees, read-only", async () => {
    const cwd = await tempRoot.createWorkspace();
    await mkdir(join(cwd, ".agent-cortex", "worktrees", "bd-1"), { recursive: true });
    await mkdir(join(cwd, ".agent-cortex", "worktrees", "bd-2"), { recursive: true });
    await writeFile(join(cwd, ".agent-cortex", "worktrees", "notes.txt"), "not a worktree");

    const found = await findWorktrees({ cwd });

    assert.deepEqual(found?.names, ["bd-1", "bd-2"]);
    assert.equal(found?.path, join(cwd, ".agent-cortex", "worktrees"));
    assert.ok(await exists(join(cwd, ".agent-cortex", "worktrees", "bd-1")), "nothing was removed");
  });

  it("reports nothing when no worktree directory exists", async () => {
    assert.equal(await findWorktrees({ cwd: await tempRoot.createWorkspace() }), null);
  });
});

describe("parseConfirmation", () => {
  it("proceeds only on an explicit yes", async () => {
    for (const yes of ["y", "Y", "yes", "YES", " y "]) assert.equal(parseConfirmation(yes), true, yes);
    for (const no of ["", "  ", "n", "no", "1", "sure"]) assert.equal(parseConfirmation(no), false, JSON.stringify(no));
  });
});

describe("formatUninstallReport", () => {
  it("prints the commands, the removals, and the no-op line", async () => {
    const report = formatUninstallReport({
      entries: [
        {
          harness: "pi",
          status: "removed",
          actions: ["/home/x/.agent-cortex/pi"],
          commands: ["pi remove /home/x/.agent-cortex/pi"],
          warnings: [],
        },
        { harness: "claude", status: "absent", actions: [], commands: [], warnings: [] },
      ],
    });
    assert.match(report, /^pi: removed$/m);
    assert.match(report, /✓ ran pi remove \/home\/x\/\.agent-cortex\/pi/);
    assert.match(report, /✓ removed \/home\/x\/\.agent-cortex\/pi/);
    assert.match(report, /^claude: already absent — nothing to remove$/m);
  });

  it("states that the shared root survives and names the worktrees it left alone", async () => {
    const report = formatUninstallReport({
      entries: [{ harness: "pi", status: "removed", actions: [], commands: [], warnings: [] }],
      sharedRoot: "/home/x/.agent-cortex",
      worktrees: { path: "/repo/.agent-cortex/worktrees", names: ["bd-1"] },
    });
    assert.match(report, /Left in place: the agent-cortex CLI .* and the shared \/home\/x\/\.agent-cortex root/);
    assert.match(report, /Left in place: 1 worktree\(s\) under \/repo\/\.agent-cortex\/worktrees \(bd-1\)/);
    assert.match(report, /git worktree remove/);
  });

  it("says would-remove and writes nothing on a dry run", async () => {
    const report = formatUninstallReport({
      entries: [
        {
          harness: "pi",
          status: "removed",
          actions: ["/home/x/.agent-cortex/pi"],
          commands: ["pi remove /home/x/.agent-cortex/pi"],
          warnings: [],
        },
      ],
      dryRun: true,
    });
    assert.match(report, /^pi: would remove$/m);
    assert.match(report, /→ would run pi remove/);
    assert.match(report, /\(dry-run — nothing written\)/);
  });
});

// ─── Claude: the symmetric inverse of the settings merge ─────────────────────

describe("uninstallClaude — settings removal symmetry", () => {
  /**
   * A package root carrying a template with declared entries, beside a plugin
   * install under a fake HOME.
   * @param {string} home
   * @returns {Promise<{ root: string, output: string, settingsPath: string, template: string }>}
   */
  async function makeFixture(home) {
    const root = join(await tempRoot.createWorkspace(), "package");
    await mkdir(join(root, "claude"), { recursive: true });
    const template = JSON.stringify(
      {
        enabledPlugins: { "team@official": true },
        extraKnownMarketplaces: { "team-market": { source: { source: "github", repo: "me/team" } } },
      },
      null,
      2,
    );
    await writeFile(join(root, "claude", "settings.json"), `${template}\n`);
    const install = await makeClaudeInstall(home);
    const settingsPath = join(home, ".claude", "settings.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    const settings = settingsWithInstallEntries();
    settings.enabledPlugins["team@official"] = true;
    settings.extraKnownMarketplaces["team-market"] = { source: { source: "github", repo: "me/team" } };
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    return { root, output: install.output, settingsPath, template };
  }

  it("removes exactly the entries the install declared and leaves every other key untouched", async () => {
    const home = await createHome();
    const fixture = await makeFixture(home);
    const fake = await makeClaudeCli(join(home, ".claude", "fake-cli"));
    await seedClaudeState(fake, { marketplaceRoot: dirname(fixture.output) });
    const before = JSON.parse(await readFile(fixture.settingsPath, "utf-8"));

    const result = await uninstallClaude({
      root: fixture.root,
      output: fixture.output,
      settingsPath: fixture.settingsPath,
      instructionsPath: join(home, ".claude", "CLAUDE.md"),
      claudeBin: fake.bin,
    });

    assert.equal(result.status, "removed");
    const after = JSON.parse(await readFile(fixture.settingsPath, "utf-8"));
    assert.deepEqual(
      after.enabledPlugins,
      { "personal@mine": true },
      "the plugin the install enabled and the template's entry are gone; the user's entry stays",
    );
    assert.deepEqual(
      after.extraKnownMarketplaces,
      { mine: { source: { source: "github", repo: "me/mine" } } },
      "the marketplace the install registered and the template's entry are gone; the user's stays",
    );
    // Every key the uninstall does not own is byte-identical, not merely equal:
    // the merge never reformats or reorders another owner's config.
    for (const key of ["permissions", "hooks", "env"]) {
      assert.equal(JSON.stringify(after[key]), JSON.stringify(before[key]), `${key} is untouched`);
    }
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), "no key was added or dropped");
  });

  it("deregisters through the Claude Code CLI, plugin first", async () => {
    const home = await createHome();
    const fixture = await makeFixture(home);
    const fake = await makeClaudeCli(join(home, ".claude", "fake-cli"));
    await seedClaudeState(fake, { marketplaceRoot: dirname(fixture.output) });

    await uninstallClaude({
      root: fixture.root,
      output: fixture.output,
      settingsPath: fixture.settingsPath,
      instructionsPath: join(home, ".claude", "CLAUDE.md"),
      claudeBin: fake.bin,
    });

    const actions = registrationActionsOf(await callLines(fake.log));
    assert.deepEqual(actions, [
      "plugin uninstall agent-cortex@jaybeeuu -y",
      "plugin marketplace remove jaybeeuu",
    ]);
    const state = JSON.parse(await readFile(fake.state, "utf-8"));
    assert.deepEqual(state.installed, []);
    assert.deepEqual(state.markets, []);
  });

  it("reports incomplete instead of throwing when the CLI rejects the plugin deregistration", async () => {
    const home = await createHome();
    const fixture = await makeFixture(home);
    const fake = await makeClaudeCli(join(home, ".claude", "fake-cli"));
    await seedClaudeState(fake, { marketplaceRoot: dirname(fixture.output) });
    await setFakeClaudeFailure(dirname(fake.bin), "plugin uninstall");
    const settingsBefore = JSON.parse(await readFile(fixture.settingsPath, "utf-8"));
    /** @type {string[]} */
    const warnings = [];

    const result = await uninstallClaude({
      root: fixture.root,
      output: fixture.output,
      settingsPath: fixture.settingsPath,
      instructionsPath: join(home, ".claude", "CLAUDE.md"),
      claudeBin: fake.bin,
      warn: (msg) => warnings.push(msg),
    });

    assert.equal(result.status, "incomplete", "a rejected command leaves the run incomplete, not thrown");
    assert.deepEqual(result.commands, [], "a rejected command is not reported as run");
    assert.equal(await exists(fixture.output), true, "the plugin directory survives");
    assert.equal(
      await exists(join(dirname(fixture.output), ".claude-plugin", "marketplace.json")),
      true,
      "the marketplace manifest survives",
    );
    assert.deepEqual(
      JSON.parse(await readFile(fixture.settingsPath, "utf-8")),
      settingsBefore,
      "the settings entries the install declared survive",
    );
    assert.equal(warnings.length, 1, "one warning states the state and the way out");
    assert.match(warnings[0], /plugin uninstall agent-cortex@jaybeeuu -y" exited 1/);
    assert.match(warnings[0], /plugin uninstall agent-cortex@jaybeeuu -y\n {2}.* plugin marketplace remove jaybeeuu/);
    assert.match(warnings[0], /the plugin directory .*, the marketplace manifest .* and every settings entry .* are left in place/);
  });

  it("reports the outstanding marketplace deregistration without repeating the plugin step that succeeded", async () => {
    const home = await createHome();
    const fixture = await makeFixture(home);
    const fake = await makeClaudeCli(join(home, ".claude", "fake-cli"));
    await seedClaudeState(fake, { marketplaceRoot: dirname(fixture.output) });
    await setFakeClaudeFailure(dirname(fake.bin), "plugin marketplace remove");
    /** @type {string[]} */
    const warnings = [];

    const result = await uninstallClaude({
      root: fixture.root,
      output: fixture.output,
      settingsPath: fixture.settingsPath,
      instructionsPath: join(home, ".claude", "CLAUDE.md"),
      claudeBin: fake.bin,
      warn: (msg) => warnings.push(msg),
    });

    assert.equal(result.status, "incomplete");
    assert.deepEqual(result.commands, [["plugin", "uninstall", "agent-cortex@jaybeeuu", "-y"]], "the plugin went first");
    const state = JSON.parse(await readFile(fake.state, "utf-8"));
    assert.deepEqual(state.installed, [], "the plugin is deregistered");
    assert.deepEqual(state.markets.map((/** @type {{ name: string }} */ market) => market.name), ["jaybeeuu"], "the marketplace stays registered");
    assert.equal(await exists(fixture.output), true, "the plugin directory survives");
    assert.match(warnings[0], /plugin marketplace remove jaybeeuu/);
    assert.doesNotMatch(warnings[0], /plugin uninstall agent-cortex/, "a completed step is not offered again");
  });

  it("deletes the plugin directory and the marketplace manifest, and the emptied marketplace dir", async () => {
    const home = await createHome();
    const fixture = await makeFixture(home);
    const fake = await makeClaudeCli(join(home, ".claude", "fake-cli"));
    await seedClaudeState(fake, { marketplaceRoot: dirname(fixture.output) });

    await uninstallClaude({
      root: fixture.root,
      output: fixture.output,
      settingsPath: fixture.settingsPath,
      instructionsPath: join(home, ".claude", "CLAUDE.md"),
      claudeBin: fake.bin,
    });

    assert.equal(await exists(fixture.output), false, "the plugin directory is gone");
    assert.equal(await exists(dirname(fixture.output) + "/.claude-plugin"), false, "the manifest directory is gone");
  });

  it("removes only the managed section of the user's memory file", async () => {
    const home = await createHome();
    const fixture = await makeFixture(home);
    const fake = await makeClaudeCli(join(home, ".claude", "fake-cli"));
    await seedClaudeState(fake, { marketplaceRoot: dirname(fixture.output) });
    const instructionsPath = join(home, ".claude", "CLAUDE.md");
    await writeFile(
      instructionsPath,
      "# Personal memory\n\n<!-- BEGIN agent-cortex:output-style -->\nUse simplified technical English.\n<!-- END agent-cortex:output-style -->\n\nKeep this trailing note.\n",
    );

    await uninstallClaude({
      root: fixture.root,
      output: fixture.output,
      settingsPath: fixture.settingsPath,
      instructionsPath,
      claudeBin: fake.bin,
    });

    const text = await readFile(instructionsPath, "utf-8");
    assert.doesNotMatch(text, /agent-cortex:output-style/);
    assert.doesNotMatch(text, /simplified technical English/);
    assert.match(text, /# Personal memory/);
    assert.match(text, /Keep this trailing note\./);
  });

  it("reports absent, writes nothing and spawns nothing when there is no install", async () => {
    const home = await createHome();
    const root = join(await tempRoot.createWorkspace(), "package");
    await mkdir(join(root, "claude"), { recursive: true });
    await writeFile(join(root, "claude", "settings.json"), JSON.stringify({ enabledPlugins: {}, extraKnownMarketplaces: {} }));
    const settingsPath = join(home, ".claude", "settings.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(settingsWithInstallEntries(), null, 2)}\n`);
    const fake = await makeClaudeCli(join(home, ".claude", "fake-cli"));
    const before = await snapshot(home);

    const result = await uninstallClaude({
      root,
      output: join(home, ".agent-cortex", "claude"),
      settingsPath,
      instructionsPath: join(home, ".claude", "CLAUDE.md"),
      claudeBin: fake.bin,
    });

    assert.equal(result.status, "absent");
    assert.deepEqual(await snapshot(home), before, "a no-op writes nothing");
    assert.deepEqual(await callLines(fake.log), [], "a no-op spawns nothing");
  });

  it("writes nothing on a dry run, and still reports what it would remove", async () => {
    const home = await createHome();
    const fixture = await makeFixture(home);
    const before = await snapshot(home);

    const result = await uninstallClaude({
      root: fixture.root,
      output: fixture.output,
      settingsPath: fixture.settingsPath,
      instructionsPath: join(home, ".claude", "CLAUDE.md"),
      dryRun: true,
    });

    assert.equal(result.status, "removed");
    assert.ok(result.removed.some((entry) => entry.includes(fixture.output)));
    assert.deepEqual(await snapshot(home), before, "the dry run wrote nothing");
  });
});

// ─── Pi: deregistration through the pi CLI ───────────────────────────────────

describe("uninstallPi", () => {
  /**
   * A staged package plus a fake pi that has it configured.
   * @param {string} home
   * @returns {Promise<{ staged: string, fake: { bin: string, log: string, settingsPath: string } }>}
   */
  async function makeFixture(home) {
    const staged = await makeStagedPi(home);
    const fake = await makePiCli(home, [staged]);
    return { staged, fake };
  }

  it("deregisters the staged path and then deletes it", async () => {
    const home = await createHome();
    const { staged, fake } = await makeFixture(home);

    const result = await uninstallPi({ output: staged, settingsPath: fake.settingsPath, piBin: fake.bin });

    assert.equal(result.status, "removed");
    assert.deepEqual(
      (await callLines(fake.log)).filter((line) => line !== "--version"),
      [`remove ${staged}`],
      "the availability probe is not a removal",
    );
    assert.equal(await exists(staged), false, "the staged package is gone");
    const settings = JSON.parse(await readFile(fake.settingsPath, "utf-8"));
    assert.deepEqual(settings.packages, [], "pi no longer lists the source");
  });

  it("leaves the registration and the staged package in place when pi refuses the removal, then removes both on a retry", async () => {
    const home = await createHome();
    const { staged, fake } = await makeFixture(home);
    await setFakePiFailure(dirname(fake.bin), "remove");

    const failed = await uninstallPi({ output: staged, settingsPath: fake.settingsPath, piBin: fake.bin });

    assert.equal(failed.status, "incomplete");
    assert.equal(await exists(staged), true, "the staged package survives a failed deregistration");
    assert.deepEqual(
      JSON.parse(await readFile(fake.settingsPath, "utf-8")).packages,
      [staged],
      "pi still names the staged source",
    );

    await setFakePiFailure(dirname(fake.bin), null);
    const retry = await uninstallPi({ output: staged, settingsPath: fake.settingsPath, piBin: fake.bin });

    assert.equal(retry.status, "removed");
    assert.equal(await exists(staged), false, "the retry deletes the staged package");
    assert.deepEqual(
      JSON.parse(await readFile(fake.settingsPath, "utf-8")).packages,
      [],
      "the retry drops the source"
    );
  });

  it("is idempotent: the second run reports absent and spawns nothing", async () => {
    const home = await createHome();
    const { staged, fake } = await makeFixture(home);
    await uninstallPi({ output: staged, settingsPath: fake.settingsPath, piBin: fake.bin });
    const callsAfterFirst = (await callLines(fake.log)).length;

    const second = await uninstallPi({ output: staged, settingsPath: fake.settingsPath, piBin: fake.bin });

    assert.equal(second.status, "absent");
    assert.equal((await callLines(fake.log)).length, callsAfterFirst, "no second deregistration");
  });

  it("writes nothing and spawns nothing on a dry run", async () => {
    const home = await createHome();
    const { staged, fake } = await makeFixture(home);
    const before = await snapshot(home);

    const result = await uninstallPi({ output: staged, settingsPath: fake.settingsPath, piBin: fake.bin, dryRun: true });

    assert.equal(result.status, "removed");
    assert.deepEqual(result.commands, [["remove", staged]]);
    assert.deepEqual(await snapshot(home), before);
    assert.deepEqual(await callLines(fake.log), [], "the dry run spawned nothing");
  });
});

// ─── The command end to end ──────────────────────────────────────────────────

describe("ctx uninstall", () => {
  it("prints the installed-harness table and the flags, then exits 1 without a terminal", async () => {
    const home = await createHome();
    await writeFingerprint(home, "pi", JSON.stringify({ version: "1.0.0" }));

    const { exitCode, stdout, stderr } = await runCli(["uninstall"], { env: { HOME: home } });

    assert.equal(exitCode, 1, "a non-interactive uninstall fails instead of blocking");
    assert.match(stdout, /^harness\s+installed\s+cli\s+status$/m, "the table header is printed");
    assert.match(stdout, /^pi\s+1\.0\.0/m, "the installed harness has a row");
    assert.doesNotMatch(stdout, /^claude\b/m, "a harness that was never installed is not offered");
    assert.match(stdout, /agent-cortex uninstall --all/, "the flags are listed so the next run is not a guess");
    assert.equal(stderr, "");
  });

  it("reports a named harness that is not installed as a no-op and exits 0", async () => {
    const home = await createHome();
    const before = await snapshot(home);

    const { exitCode, stdout } = await runCli(["uninstall", "pi"], { env: { HOME: home } });

    assert.equal(exitCode, 0);
    assert.match(stdout, /^pi: already absent — nothing to remove$/m);
    assert.deepEqual(await snapshot(home), before, "nothing was written");
  });

  it("exits 1 for a harness name the CLI does not support", async () => {
    const { exitCode, stderr } = await runCli(["uninstall", "docker"]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /Unknown harness "docker"/);
  });

  it("removes a pi install, deregisters it, and is safe to run twice", async () => {
    const home = await createHome();
    const staged = await makeStagedPi(home);
    const fake = await makePiCli(home, [staged]);
    const env = { HOME: home, PATH: [dirname(fake.bin), SYSTEM_PATH].join(":") };

    const first = await runCli(["uninstall", "pi"], { env });

    assert.equal(first.exitCode, 0);
    assert.match(first.stdout, /^pi: removed$/m);
    assert.match(first.stdout, /✓ ran pi remove /);
    assert.match(first.stdout, /Left in place: the agent-cortex CLI/);
    assert.equal(await exists(staged), false);

    const second = await runCli(["uninstall", "pi"], { env });

    assert.equal(second.exitCode, 0, "the second run is safe");
    assert.match(second.stdout, /^pi: already absent — nothing to remove$/m);
  });

  it("removes every install with --all, asks nothing without a terminal, and says what it left", async () => {
    const home = await createHome();
    const staged = await makeStagedPi(home);
    const fake = await makePiCli(home, [staged]);
    await writeFingerprint(home, "pi", JSON.stringify({ version: "1.0.0" }));
    const env = { HOME: home, PATH: [dirname(fake.bin), SYSTEM_PATH].join(":") };

    const { exitCode, stdout } = await runCli(["uninstall", "--all"], { env });

    assert.equal(exitCode, 0);
    assert.match(stdout, /^pi: removed$/m);
    assert.match(stdout, /Left in place: the agent-cortex CLI .* and the shared .*\.agent-cortex root/);
    assert.ok(await exists(join(home, ".agent-cortex")), "the shared root survives --all");
  });

  it("reports a worktree a ralph run created and never deletes it", async () => {
    const home = await createHome();
    const repo = await tempRoot.createWorkspace();
    await mkdir(join(repo, ".agent-cortex", "worktrees", "bd-42"), { recursive: true });
    const staged = await makeStagedPi(home);
    const fake = await makePiCli(home, [staged]);
    await writeFingerprint(home, "pi", JSON.stringify({ version: "1.0.0" }));
    const env = { HOME: home, PATH: [dirname(fake.bin), SYSTEM_PATH].join(":") };

    const { exitCode, stdout } = await runCli(["uninstall", "--all"], { env, cwd: repo });

    assert.equal(exitCode, 0);
    assert.match(stdout, /Left in place: 1 worktree\(s\) under .*worktrees \(bd-42\)/);
    assert.ok(await exists(join(repo, ".agent-cortex", "worktrees", "bd-42")), "the worktree is untouched");
  });

  it("writes nothing with --dry-run", async () => {
    const home = await createHome();
    const staged = await makeStagedPi(home);
    const fake = await makePiCli(home, [staged]);
    await writeFingerprint(home, "pi", JSON.stringify({ version: "1.0.0" }));
    const before = await snapshot(home);
    const env = { HOME: home, PATH: [dirname(fake.bin), SYSTEM_PATH].join(":") };

    const { exitCode, stdout } = await runCli(["uninstall", "pi", "--dry-run"], { env });

    assert.equal(exitCode, 0);
    assert.match(stdout, /^pi: would remove$/m);
    assert.match(stdout, /\(dry-run — nothing written\)/);
    assert.deepEqual(await snapshot(home), before, "the dry run wrote nothing");
    assert.deepEqual(await callLines(fake.log), [], "the dry run deregistered nothing");
  });

  it("reports an incomplete claude uninstall and still removes the other harness with --all", async () => {
    const home = await createHome();
    const install = await makeClaudeInstall(home);
    const settingsPath = join(home, ".claude", "settings.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    const settings = settingsWithInstallEntries();
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    const claudeFake = await makeClaudeCli(join(home, ".claude", "fake-cli"));
    await seedClaudeState(claudeFake, { marketplaceRoot: install.marketplaceRoot });
    await setFakeClaudeFailure(dirname(claudeFake.bin), "plugin uninstall");
    const staged = await makeStagedPi(home);
    const piFake = await makePiCli(home, [staged]);
    const env = {
      HOME: home,
      PATH: [dirname(claudeFake.bin), dirname(piFake.bin), SYSTEM_PATH].join(":"),
    };

    const { exitCode, stdout, stderr } = await runCli(["uninstall", "--all"], { env });

    assert.equal(exitCode, 1, "an outstanding registration fails the run");
    assert.equal(stderr, "", "the state is reported, not thrown as a bare error");
    assert.match(stdout, /^claude: partially removed — the harness registration is still outstanding$/m);
    assert.match(stdout, /⚠ "claude .*plugin uninstall agent-cortex@jaybeeuu -y" exited 1/);
    assert.match(stdout, /claude plugin marketplace remove jaybeeuu/, "the report names the exact recovery command");
    assert.match(stdout, /^pi: removed$/m, "--all still removes the harness that can be removed");
    assert.equal(await exists(install.output), true, "the claude plugin directory survives");
    assert.equal(await exists(install.manifestPath), true, "the marketplace manifest survives");
    assert.deepEqual(
      JSON.parse(await readFile(settingsPath, "utf-8")),
      settings,
      "the settings entries the install declared survive",
    );
    assert.equal(await exists(staged), false, "the pi staged package is gone");

    // The warning ends with "then re-run", so the same command must finish once
    // the CLI accepts the deregistration again.
    await setFakeClaudeFailure(dirname(claudeFake.bin), null);
    const retry = await runCli(["uninstall", "claude"], { env });

    assert.equal(retry.exitCode, 0, retry.stdout);
    assert.match(retry.stdout, /^claude: removed$/m);
    assert.equal(await exists(install.output), false, "the retry removes the plugin directory");
  });

  it("removes a claude install and its declared settings entries end to end, leaving personal config", async () => {
    const home = await createHome();
    const install = await makeClaudeInstall(home);
    const settingsPath = join(home, ".claude", "settings.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(settingsWithInstallEntries(), null, 2)}\n`);
    const fake = await makeClaudeCli(join(home, ".claude", "fake-cli"));
    await seedClaudeState(fake, { marketplaceRoot: install.marketplaceRoot });
    const env = { HOME: home, PATH: [dirname(fake.bin), SYSTEM_PATH].join(":") };

    const { exitCode, stdout } = await runCli(["uninstall", "claude"], { env });

    assert.equal(exitCode, 0, stdout);
    assert.match(stdout, /^claude: removed$/m);
    assert.equal(await exists(install.output), false, "the plugin directory is gone");
    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    assert.deepEqual(settings.enabledPlugins, { "personal@mine": true });
    assert.deepEqual(settings.extraKnownMarketplaces, { mine: { source: { source: "github", repo: "me/mine" } } });
    assert.equal(settings.env.PERSONAL_FLAG, "1");
  });
});
