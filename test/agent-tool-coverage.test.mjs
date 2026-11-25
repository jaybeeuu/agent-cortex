// Coverage: an agent's authored tool set must grant every capability its own text
// names, on every harness.
//
// The bug this closes shipped silently: ralph's text instructed it to call the
// peer tools four times, its pi tool list named none of them, and nothing compared
// the two. The agent then reported the tools as unavailable, which reads like a
// transport fault rather than a missing entry in a list.
//
// Both harnesses are staged into workspaces under a per-process temp root that a
// file-level after() hook removes, and the rendered tool list is read from the
// staged agent file — never from this checkout. The authored text (agent.md,
// section files, the skills the agent's tools.json lists) is where the capability
// tokens live; the staged frontmatter is what the harness actually grants.
//
// Three cases are proved with fixtures as well as against the real tree:
//   - an agent whose text names a capability its set omits → fails, naming both;
//   - a capability the harness exposes as a command, authored in a tool set → fails;
//   - an agent whose set covers its text → passes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isAllTools, loadTokenMap, translateToolList } from "../scripts/lib/compose-agent.mjs";
import { checkToolCoverage } from "../scripts/lib/tool-coverage.mjs";
import { validateToolSet } from "../scripts/validate-agent-dir.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI_PATH = join(ROOT, "bin", "agent-cortex.mjs");
const HARNESSES = /** @type {const} */ (["claude", "pi"]);

const tempRoot = createTempRoot("agent-cortex-tool-coverage-");

/** Run the CLI.
 * @param {string[]} args
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>} */
function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI_PATH, ...args], { env: process.env }, (error, stdout, stderr) => {
      resolve({ exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

/**
 * The tool list a staged agent file grants. `null` means the frontmatter carried
 * no `tools:` line, which both installers emit for the all-tools sentinel.
 * @param {string} file
 * @returns {Promise<string[] | null>}
 */
async function renderedTools(file) {
  const content = await readFile(file, "utf-8");
  const match = content.match(/^tools: (.*)$/m);
  if (!match) return null;
  const raw = match[1].trim();
  // pi renders `tools: "bash, read"` (a JSON string); claude renders
  // `tools: Bash, Read` (a bare comma-separated scalar).
  const names = raw.startsWith('"') ? JSON.parse(raw) : raw;
  return String(names)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Stage one harness's install and return the temp output directory.
 * @param {"claude" | "pi"} harness
 * @returns {Promise<string>}
 */
async function stageInstall(harness) {
  const out = await tempRoot.createWorkspace();
  const result = await runCli(["install", harness, "--output", out]);
  assert.equal(result.exitCode, 0, `install ${harness} --output failed: ${result.stdout}${result.stderr}`);
  return out;
}

/** The staged agent file for one agent on one harness.
 * @param {string} out
 * @param {string} agent
 * @param {"claude" | "pi"} harness
 * @returns {string}
 */
function stagedAgentFile(out, agent, harness) {
  return harness === "pi" ? join(out, "agents", `${agent}.agent.md`) : join(out, "agents", `${agent}.md`);
}

// ─── Fixture package root ────────────────────────────────────────────────────

/**
 * A throwaway package root holding one authored agent, so a check can be proved
 * to fail as well as pass. `tokenMap.json` here is the real one, copied verbatim:
 * the rows under test are the shipped rows, not a hand-written substitute.
 * @param {{ agent: string, body: string, tools: string[], skills?: Record<string, string> }} spec
 * @returns {Promise<string>}
 */
async function packageRoot({ agent, body, tools, skills = {} }) {
  const root = await tempRoot.createWorkspace();
  await writeFile(join(root, "token-map.json"), await readFile(join(ROOT, "token-map.json"), "utf-8"));
  await mkdir(join(root, "agents", agent, "claude"), { recursive: true });
  await mkdir(join(root, "agents", agent, "pi"), { recursive: true });
  await writeFile(join(root, "agents", agent, "agent.md"), body);
  for (const harness of HARNESSES) {
    await writeFile(
      join(root, "agents", agent, harness, "frontmatter.json"),
      JSON.stringify({ name: `agent-cortex:${agent}`, description: `${agent}.` }),
    );
  }
  await writeFile(join(root, "agents", agent, "tools.json"), JSON.stringify({ tools, skills: Object.keys(skills) }));
  for (const [entry, text] of Object.entries(skills)) {
    const dir = join(root, "skills", ...entry.split("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), text);
  }
  return root;
}

/** Render one fixture agent's tool list for a harness, as its installer would.
 * @param {string} root
 * @param {string} agent
 * @param {"claude" | "pi"} harness
 * @returns {Promise<string[] | null>}
 */
async function renderFixtureTools(root, agent, harness) {
  const authored = JSON.parse(await readFile(join(root, "agents", agent, "tools.json"), "utf-8"));
  const tokenMap = await loadTokenMap(root);
  const tools = translateToolList(authored.tools, tokenMap, harness, { warn: () => {} });
  return isAllTools(tools) ? null : tools;
}

// ─── The real tree ──────────────────────────────────────────────────────────

describe("authored tool sets", () => {
  it("every agent authors one tools.json, and no frontmatter carries tools", async () => {
    const agentsDir = join(ROOT, "agents");
    const agents = (await readdir(agentsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.ok(agents.length > 0, "expected the composable agents");

    for (const agent of agents) {
      const authored = JSON.parse(await readFile(join(agentsDir, agent, "tools.json"), "utf-8"));
      assert.deepEqual(validateToolSet(authored), { ok: true, errors: [] }, `${agent}/tools.json is valid`);

      for (const harness of HARNESSES) {
        const frontmatter = JSON.parse(
          await readFile(join(agentsDir, agent, harness, "frontmatter.json"), "utf-8"),
        );
        assert.equal(frontmatter.tools, undefined, `${agent}/${harness}/frontmatter.json carries no tools`);
      }
    }
  });

  for (const harness of HARNESSES) {
    it(`${harness}: every staged agent grants every tool its own text names`, async () => {
      const out = await stageInstall(harness);
      const tokenMap = await loadTokenMap(ROOT);
      const agents = (await readdir(join(ROOT, "agents"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      assert.ok(agents.length > 0, "expected the composable agents");

      /** @type {string[]} */
      const violations = [];
      /** @type {string[]} */
      const stretch = [];
      for (const agent of agents) {
        const rendered = await renderedTools(stagedAgentFile(out, agent, harness));
        const result = await checkToolCoverage({ root: ROOT, agentName: agent, harness, tokenMap, rendered });
        violations.push(...result.violations.map((violation) => violation.message));
        stretch.push(...result.required.map((key) => `${agent}:${key}`));
      }

      assert.deepEqual(violations, [], `tool sets that do not cover their own text on ${harness}`);
      // The check must be able to fail: if no capability were required, a broken
      // row would pass unnoticed, which is the bug this file exists to close.
      assert.ok(
        stretch.includes("ralph:peer_send") && stretch.includes("ralph:peer_list"),
        `expected ralph's text to require the peer tools (got ${stretch.join(", ")})`,
      );
    });
  }

  it("pi: ralph's staged tool list grants the four peer capabilities, and claude's omits the two it lacks", async () => {
    const piOut = await stageInstall("pi");
    const ralphPi = /** @type {string[]} */ (await renderedTools(stagedAgentFile(piOut, "ralph", "pi")));
    for (const tool of ["peer_send", "peer_list", "peer_get", "peer_await"]) {
      assert.ok(ralphPi.includes(tool), `pi ralph grants ${tool} — got ${ralphPi.join(", ")}`);
    }

    const claudeOut = await stageInstall("claude");
    const ralphClaude = /** @type {string[]} */ (await renderedTools(stagedAgentFile(claudeOut, "ralph", "claude")));
    for (const tool of ["SendMessage", "ListAgents"]) {
      assert.ok(ralphClaude.includes(tool), `claude ralph grants ${tool} — got ${ralphClaude.join(", ")}`);
    }
    for (const tool of ["peer_get", "peer_await"]) {
      assert.ok(!ralphClaude.includes(tool), `claude ralph has no counterpart for ${tool}`);
    }
  });

  it("the staged install reports no warning about a peer capability it has no counterpart for", async () => {
    // A harness-only row in a one-for-two tool set is the normal case, not a
    // defect, so omitting it must be silent: a warning on every install is noise
    // that hides the warnings that matter.
    const out = await tempRoot.createWorkspace();
    const result = await runCli(["install", "claude", "--output", out]);
    assert.equal(result.exitCode, 0, result.stderr);
    const noise = `${result.stdout}${result.stderr}`
      .split("\n")
      .filter((line) => /peer_|capability/i.test(line));
    assert.deepEqual(noise, [], "no capability warnings on a claude install");
  });
});

// ─── The check can fail ─────────────────────────────────────────────────────

describe("task coverage check", () => {
  it("fails when an agent's text names a capability its tool set does not grant", async () => {
    // The shipped bug, in miniature: the text names the peer tools, the set does
    // not, and the message has to name both so the fix is obvious.
    const root = await packageRoot({
      agent: "mute",
      body: "# mute\n\nMessage the planner with {{CAPABILITY:peer_send}} when the plan is ready.\n",
      tools: ["bash"],
    });
    const tokenMap = await loadTokenMap(root);
    const rendered = await renderFixtureTools(root, "mute", "pi");

    const { violations } = await checkToolCoverage({ root, agentName: "mute", harness: "pi", tokenMap, rendered });

    assert.equal(violations.length, 1);
    assert.equal(violations[0].kind, "ungranted");
    assert.equal(violations[0].capability, "peer_send");
    assert.match(violations[0].message, /agent "mute"/);
    assert.match(violations[0].message, /peer_send/);
    assert.match(violations[0].message, /add "peer_send" to agents\/mute\/tools\.json/);
  });

  it("fails for a capability named only in a skill the agent lists", async () => {
    const root = await packageRoot({
      agent: "deaf",
      body: "# deaf\n\nFollow the listed skill.\n",
      tools: ["bash"],
      skills: { "workflow/speaking": "Ask the planner with {{CAPABILITY:peer_list}}.\n" },
    });
    const tokenMap = await loadTokenMap(root);
    const rendered = await renderFixtureTools(root, "deaf", "claude");

    const { violations } = await checkToolCoverage({ root, agentName: "deaf", harness: "claude", tokenMap, rendered });

    assert.deepEqual(
      violations.map((violation) => [violation.kind, violation.capability]),
      [["ungranted", "peer_list"]],
    );
    assert.match(violations[0].message, /agent "deaf"/);
    assert.match(violations[0].message, /ListAgents/);
  });

  it("fails when a listed skill entry names no skill directory", async () => {
    const root = await packageRoot({
      agent: "stale",
      body: "# stale\n",
      tools: ["bash"],
    });
    await writeFile(
      join(root, "agents", "stale", "tools.json"),
      JSON.stringify({ tools: ["bash"], skills: ["workflow/gone"] }),
    );
    const tokenMap = await loadTokenMap(root);
    const rendered = await renderFixtureTools(root, "stale", "pi");

    const { violations } = await checkToolCoverage({ root, agentName: "stale", harness: "pi", tokenMap, rendered });

    assert.deepEqual(
      violations.map((violation) => violation.kind),
      ["unresolved-skill"],
    );
    assert.match(violations[0].message, /workflow\/gone/);
  });

  it("passes when the tool set covers the text, and does not demand a command or a null mapping", async () => {
    const root = await packageRoot({
      agent: "sound",
      body:
        "# sound\n\n" +
        "Message with {{CAPABILITY:peer_send}}.\n" +
        "Watch with {{CAPABILITY:post_merge_watch}}.\n" +
        "Rewind with {{CAPABILITY:interrupt_rewind}}.\n",
      // post_merge_watch is a command on pi; interrupt_rewind is a claude command;
      // neither can be granted through a set both harnesses render, so neither is
      // demanded. peer_send is a tool on both, so it is.
      tools: ["bash", "peer_send"],
    });
    const tokenMap = await loadTokenMap(root);

    for (const harness of HARNESSES) {
      const rendered = await renderFixtureTools(root, "sound", harness);
      const { violations, required } = await checkToolCoverage({
        root,
        agentName: "sound",
        harness,
        tokenMap,
        rendered,
      });
      assert.deepEqual(violations, [], `${harness}: the set covers the text`);
      assert.deepEqual(required, ["peer_send"], `${harness}: only a tool on both harnesses is required`);
    }
  });

  it("passes an all-tools set, which grants everything", async () => {
    const root = await packageRoot({
      agent: "wide",
      body: "# wide\n\nMessage with {{CAPABILITY:peer_send}}.\n",
      tools: ["*"],
    });
    const tokenMap = await loadTokenMap(root);

    const { violations } = await checkToolCoverage({
      root,
      agentName: "wide",
      harness: "claude",
      tokenMap,
      rendered: null,
    });
    assert.deepEqual(violations, []);
  });

  it("fails when a tool set lists a capability the harness exposes as a command", async () => {
    const root = await packageRoot({
      agent: "wrong",
      body: "# wrong\n",
      // post_merge_watch is a command on pi: the model cannot call it, so it may
      // never be granted through a tool list.
      tools: ["bash", "post_merge_watch"],
    });
    const tokenMap = await loadTokenMap(root);

    assert.throws(
      () => translateToolList(["bash", "post_merge_watch"], tokenMap, "pi", { warn: () => {} }),
      /capability "post_merge_watch" is a pi command \(post-merge-watch\) and cannot appear in a tool list/,
    );
  });
});
