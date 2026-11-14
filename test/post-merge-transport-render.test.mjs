// The post-merge stage's watch is forked at install time, not in two skill
// files: one authored playbook renders this package's own `post-merge-watch`
// extension on pi and Claude Code's built-in `ScheduleWakeup` tool on claude.
// These tests stage both installs and read the rendered playbook, so a harness
// that loses its mechanism fails here instead of silently degrading. Both stages
// go to workspaces under a per-process temp root that a file-level after() hook
// removes, and the checkout's own sources are never read as the artefact under
// test — only the staged trees are.

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

const WATCH_HEADING = "## Watch transport";
const PLACEHOLDER = "<WATCH>";

/** Where each harness materialises the stage playbooks: pi keeps the grouped
 * source layout, claude flattens one directory per skill.
 * @type {Record<"pi" | "claude", string[]>} */
const PLAYBOOK = {
  pi: ["skills", "workflow", "run-pipeline-stage", "playbooks", "post-merge.md"],
  claude: ["skills", "run-pipeline-stage", "playbooks", "post-merge.md"],
};

/** The mechanism each harness must name, and the other's name it must not.
 * @type {Record<"pi" | "claude", { own: string, other: string }>} */
const MECHANISM = {
  pi: { own: "post-merge-watch", other: "ScheduleWakeup" },
  claude: { own: "ScheduleWakeup", other: "post-merge-watch" },
};

/** @type {ReturnType<typeof createTempRoot>} */
const tempRoot = createTempRoot("agent-cortex-post-merge-");

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

/** Stage both installs once and read their rendered post-merge playbooks.
 * @returns {Promise<{ pi: string, claude: string, stdout: string }>} */
let staged = null;
function stageBoth() {
  staged ??= (async () => {
    /** @type {Record<string, string>} */
    const rendered = {};
    /** @type {string[]} */
    const output = [];
    for (const harness of /** @type {const} */ (["pi", "claude"])) {
      const out = await tempRoot.createWorkspace();
      const result = await runCli(["install", harness, "--output", out]);
      assert.equal(result.exitCode, 0, `install ${harness} failed: ${result.stdout}${result.stderr}`);
      output.push(result.stdout, result.stderr);
      rendered[harness] = await readFile(join(out, ...PLAYBOOK[harness]), "utf-8");
    }
    return { ...rendered, stdout: output.join("\n") };
  })();
  return staged;
}

/** One markdown section: from its heading up to the next heading of the same or a
 * shallower depth.
 * @param {string} doc
 * @param {string} heading  literal heading text, e.g. "## Watch transport"
 * @returns {string} */
function section(doc, heading) {
  const start = doc.indexOf(heading);
  assert.notEqual(start, -1, `heading "${heading}" is missing`);
  const depth = /** @type {number} */ (heading.match(/^#+/)?.[0].length);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${depth}} `));
  return next === -1 ? rest : rest.slice(0, next);
}

describe("post-merge watch transport renders per harness", () => {
  it("names the harness's own watch mechanism in the transport section", async () => {
    const { pi, claude } = await stageBoth();

    /** @type {Record<string, string>} */
    const transports = {
      pi: section(pi, WATCH_HEADING),
      claude: section(claude, WATCH_HEADING),
    };

    for (const harness of /** @type {const} */ (["pi", "claude"])) {
      const transport = transports[harness];
      const { own, other } = MECHANISM[harness];

      assert.ok(transport.includes(`with ${own} `), `${harness} transport names ${own}`);
      assert.equal(transport.split(own).length - 1, 1, `${harness} transport names ${own} exactly once`);
      assert.ok(!transport.includes(other), `the ${harness} transport names no ${other}`);
    }
  });

  it("keeps the transport text identical once the mechanism name is set aside", async () => {
    const { pi, claude } = await stageBoth();

    // Replacing the harness's own name with one placeholder means a dropped
    // token — a null column, or a renamed key — leaves the two renders
    // different instead of both quietly losing a word.
    const normalise = (/** @type {string} */ doc, /** @type {string} */ own) => {
      const transport = section(doc, WATCH_HEADING);
      assert.ok(transport.includes(own), `the transport names ${own} before it is normalised`);
      return transport.replace(own, PLACEHOLDER);
    };

    assert.equal(
      normalise(pi, MECHANISM.pi.own),
      normalise(claude, MECHANISM.claude.own),
      "the transport section is the same text apart from the mechanism name",
    );
  });

  it("states the no-watcher fallback in both renders", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const transport = section(doc, WATCH_HEADING);
      // A session with no watch mechanism must be told what to do instead, and
      // the fallback must not itself depend on the mechanism: it is the same
      // single run with a longer window on both harnesses.
      assert.match(transport, /no such mechanism/i, `${harness} states the no-watcher case`);
      assert.match(transport, /--wait 1800/, `${harness} names the longer wait window`);
    }
  });

  it("renders the verdicts, the escalation rule and the close rule byte-identically", async () => {
    const { pi, claude } = await stageBoth();

    const shared = (/** @type {string} */ doc) => doc.replace(section(doc, WATCH_HEADING), "");

    // Everything outside the transport section — the stage instructions, the
    // verdict meanings in step 3, the never-retry rule in step 4, the outcome
    // and the remediation chain — is one authored copy and must stay so.
    assert.equal(shared(pi), shared(claude), "the verdict and escalation text is identical across harnesses");

    for (const marker of ["`0`", "`1`", "`2`", "escalation bead", "leave the chore **open**"]) {
      assert.ok(pi.includes(marker) && claude.includes(marker), `both renders keep "${marker}"`);
    }
  });

  it("leaves no surviving token and no dropped-name prose in either render", async () => {
    const { pi, claude, stdout } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      assert.doesNotMatch(doc, /\{\{TOOL:|\{\{PATH:/, `${harness} playbook carries no literal token`);
      // A null mapping drops the token and leaves its sentence missing a name;
      // the shipped source must therefore never rely on one.
      assert.doesNotMatch(doc, /\bwith\s{2,}/, `${harness} playbook has no dropped-name gap`);
      assert.doesNotMatch(doc, /\bwith\s*[,;]/, `${harness} playbook has no dropped-name gap`);
    }
    assert.doesNotMatch(stdout, /has no (?:claude|pi) mapping/, "no shipped skill uses a null-mapped tool token");
  });
});
