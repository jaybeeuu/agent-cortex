// The planner ↔ ralph peer channel is forked at install time, not in two skill
// files: one authored convention renders pi-peer's tools on pi and Claude Code's
// built-in messaging on claude. These tests stage both installs and read the
// rendered skills, so a harness that loses its mechanism fails here instead of
// silently degrading. Both stages go to workspaces under a per-process temp root
// that a file-level after() hook removes, and the checkout's own sources are
// never read as the artefact under test — only the staged trees are.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTempRoot } from "./helpers/temp-root.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI_PATH = join(ROOT, "bin", "agent-cortex.mjs");

/** @type {ReturnType<typeof createTempRoot>} */
const tempRoot = createTempRoot("agent-cortex-transport-");

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

/** Where each harness materialises the planner ↔ ralph skills: pi keeps the
 * grouped source layout, claude flattens one directory per skill.
 * @typedef {{ ralphReference: string[], ralphSkill: string[], planSkill: string[] }} SkillLayout */

/** @type {Record<"pi" | "claude", SkillLayout>} */
const LAYOUT = {
  pi: { ralphReference: ["skills", "workflow", "ralph", "REFERENCE.md"], ralphSkill: ["skills", "workflow", "ralph", "SKILL.md"], planSkill: ["skills", "workflow", "plan", "SKILL.md"] },
  claude: { ralphReference: ["skills", "ralph", "REFERENCE.md"], ralphSkill: ["skills", "ralph", "SKILL.md"], planSkill: ["skills", "plan", "SKILL.md"] },
};

/** Stage both installs once and read their rendered peer-messaging skills.
 * @returns {Promise<{ pi: Record<string, string>, claude: Record<string, string>, stdout: string, stderr: string }>} */
let staged = null;
function stageBoth() {
  staged ??= (async () => {
    /** @type {Record<string, Record<string, string>>} */
    const rendered = {};
    /** @type {string[]} */
    const output = [];
    for (const harness of /** @type {const} */ (["pi", "claude"])) {
      const out = await tempRoot.createWorkspace();
      const result = await runCli(["install", harness, "--output", out]);
      assert.equal(result.exitCode, 0, `install ${harness} failed: ${result.stdout}${result.stderr}`);
      output.push(result.stdout, result.stderr);
      /** @type {Record<string, string>} */
      const files = {};
      for (const [key, segments] of Object.entries(LAYOUT[harness])) {
        files[key] = await readFile(join(out, ...segments), "utf-8");
      }
      rendered[harness] = files;
    }
    return { ...rendered, stdout: output.join("\n"), stderr: "" };
  })();
  return staged;
}

/** One markdown section: from its heading up to the next heading of the same or a
 * shallower depth.
 * @param {string} doc
 * @param {string} heading  literal heading text, e.g. "### Transport"
 * @returns {string} */
function section(doc, heading) {
  const start = doc.indexOf(heading);
  assert.notEqual(start, -1, `heading "${heading}" is missing`);
  const depth = /** @type {number} */ (heading.match(/^#+/)?.[0].length);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${depth}} `));
  return next === -1 ? rest : rest.slice(0, next);
}

describe("peer-messaging transport renders per harness", () => {
  it("renders the pi-peer tools on pi and Claude Code's built-in tools on claude", async () => {
    const { pi, claude } = await stageBoth();

    const piTransport = section(pi.ralphReference, "### Transport");
    assert.ok(piTransport.includes("with peer_send"), "pi transport names peer_send");
    assert.ok(piTransport.includes("with peer_list"), "pi transport names peer_list");

    const claudeTransport = section(claude.ralphReference, "### Transport");
    assert.ok(claudeTransport.includes("with SendMessage"), "claude transport names SendMessage");
    assert.ok(claudeTransport.includes("with ListAgents"), "claude transport names ListAgents");

    // A harness must not be handed the other's mechanism in its own transport
    // paragraph: that is the defect the token fork exists to prevent.
    assert.doesNotMatch(piTransport, /SendMessage|ListAgents/, "the pi transport names no Claude Code tool");
    assert.doesNotMatch(claudeTransport, /peer_send|peer_list|peer_get|peer_await/, "the claude transport names no pi-peer tool");
  });

  it("names the harness's own tools in the skills that send and report", async () => {
    const { pi, claude } = await stageBoth();

    for (const skill of ["ralphSkill", "planSkill"]) {
      assert.match(pi[skill], /\bpeer_send\b/, `pi ${skill} names peer_send`);
      assert.match(pi[skill], /\bpeer_list\b/, `pi ${skill} names peer_list`);
      assert.doesNotMatch(pi[skill], /SendMessage|ListAgents/, `pi ${skill} names no Claude Code tool`);

      assert.match(claude[skill], /\bSendMessage\b/, `claude ${skill} names SendMessage`);
      assert.match(claude[skill], /\bListAgents\b/, `claude ${skill} names ListAgents`);
      assert.doesNotMatch(claude[skill], /\bpeer_send\b|\bpeer_list\b/, `claude ${skill} names no pi-peer tool`);
    }
  });

  it("keeps pi-peer's untokenised tools inside the harness-labelled runbook", async () => {
    const { claude } = await stageBoth();
    const runbook = section(claude.ralphReference, "### The `pi-peer` package (PI)");
    const outside = claude.ralphReference.replace(runbook, "");

    // peer_get/peer_await have no claude mapping, so naming them outside the
    // runbook would either leave a literal token or, once dropped, a broken
    // sentence. Their absence from the token map is what this asserts.
    assert.doesNotMatch(outside, /peer_get|peer_await/, "pi-peer-only tools stay in the runbook");
    assert.doesNotMatch(outside, /peer_send|peer_list/, "pi-peer tool names stay in the runbook");
  });

  it("renders the message kinds and the acknowledgement rule byte-identically", async () => {
    const { pi, claude } = await stageBoth();

    const shared = (/** @type {string} */ doc) =>
      section(doc, "### Message kinds") + section(doc, "### Acknowledgement rule");

    assert.equal(shared(pi.ralphReference), shared(claude.ralphReference), "kinds and ack rule are identical across harnesses");

    const kinds = section(pi.ralphReference, "### Message kinds");
    for (const kind of ["handoff", "done", "blocked", "failed", "update", "get", "ask"]) {
      assert.ok(kinds.includes(`\`${kind}\``), `kind \`${kind}\` is in the table`);
    }
  });

  it("leaves no surviving token and no dropped-tool prose in either render", async () => {
    const { pi, claude, stdout } = await stageBoth();

    for (const [harness, files] of [["pi", pi], ["claude", claude]]) {
      for (const [key, content] of Object.entries(files)) {
        assert.doesNotMatch(content, /\{\{TOOL:|\{\{PATH:/, `${harness} ${key} carries no literal token`);
        // A null mapping drops the token and leaves its sentence missing a name;
        // the shipped sources must therefore never name a tool one harness lacks.
        assert.doesNotMatch(content, /\bwith\s*[,;]/, `${harness} ${key} has no dropped-name gap`);
        assert.doesNotMatch(content, /\b(?:with|through)\s{2,}/, `${harness} ${key} has no dropped-name gap`);
      }
    }
    assert.doesNotMatch(stdout, /has no (?:claude|pi) mapping/, "no shipped skill uses a null-mapped tool token");
  });
});
