// guppi's write boundary is one authored body, not one per harness: it is
// composed at install time, so what a reader may do is decided by the render and
// not by the source. These tests stage both installs and read the rendered agent,
// because the refusal this boundary replaces was a property of the rendered text
// — an edit under the workspace's working notes read as forbidden. Both stages go
// to workspaces under a per-process temp root that a file-level after() hook
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

const BOUNDARIES = "## Boundaries";
const WRITE_SCOPE = "## Where guppi writes";

/** Where each harness materialises the composed agent.
 * @type {Record<"pi" | "claude", string[]>} */
const AGENT_PATH = {
  pi: ["agents", "guppi.agent.md"],
  claude: ["agents", "guppi.md"],
};

/** @type {ReturnType<typeof createTempRoot>} */
const tempRoot = createTempRoot("agent-cortex-guppi-boundary-");

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

/** Stage both installs once and read their rendered guppi agents.
 * @returns {Promise<Record<"pi" | "claude", string>>} */
let staged = null;
function stageBoth() {
  staged ??= (async () => {
    /** @type {Record<string, string>} */
    const rendered = {};
    for (const harness of /** @type {const} */ (["pi", "claude"])) {
      const out = await tempRoot.createWorkspace();
      const result = await runCli(["install", harness, "--output", out]);
      assert.equal(result.exitCode, 0, `install ${harness} failed: ${result.stdout}${result.stderr}`);
      rendered[harness] = await readFile(join(out, ...AGENT_PATH[harness]), "utf-8");
    }
    return /** @type {Record<"pi" | "claude", string>} */ (rendered);
  })();
  return staged;
}

/** Collapse whitespace, so a phrase assertion is not tied to where the file
 * happens to wrap.
 * @param {string} text
 * @returns {string} */
function flat(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** One markdown section: from its heading up to the next heading of the same or a
 * shallower depth.
 * @param {string} doc
 * @param {string} heading  literal heading text, e.g. "## Boundaries"
 * @returns {string} */
function section(doc, heading) {
  const start = doc.indexOf(heading);
  assert.notEqual(start, -1, `heading "${heading}" is missing`);
  const depth = /** @type {number} */ (heading.match(/^#+/)?.[0].length);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${depth}} `));
  return next === -1 ? rest : rest.slice(0, next);
}

describe("guppi's write boundary renders from one authored body", () => {
  it("renders one boundary for both harnesses, with no literal token left in either", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      for (const heading of [BOUNDARIES, WRITE_SCOPE]) {
        const rendered = section(doc, heading);
        assert.ok(!rendered.includes("{{"), `${harness} renders "${heading}" with no literal token`);
      }
    }

    // A rule that differs per harness would be a fork, and nothing here needs
    // one: the boundary names mechanisms as skills and repositories, so both
    // renders must carry the same words.
    assert.equal(
      flat(section(pi, BOUNDARIES)),
      flat(section(claude, BOUNDARIES)),
      "both harnesses render the same Boundaries text",
    );
    assert.equal(
      flat(section(pi, WRITE_SCOPE)),
      flat(section(claude, WRITE_SCOPE)),
      "both harnesses render the same write scope",
    );
  });

  it("permits an edit inside the current workspace, working notes included, without asking first", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const scope = flat(section(doc, WRITE_SCOPE));

      assert.match(
        scope,
        /writes anywhere inside the \*\*current workspace\*\*/i,
        `${harness} permits a write anywhere in the current workspace`,
      );
      assert.match(
        scope,
        /working notes under `\.agent-cortex\/working-docs\/`/i,
        `${harness} names the working notes as writable`,
      );
      assert.match(
        scope,
        /an edit that obviously serves the task needs no permission first/i,
        `${harness} needs no permission for an edit that serves the task`,
      );
    }
  });

  it("keeps the AFK prohibition and states no blanket ban on acting", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const boundary = `${flat(section(doc, BOUNDARIES))} ${flat(section(doc, WRITE_SCOPE))}`;

      assert.match(
        boundary,
        /never claims or implements an `execution:afk` bead/i,
        `${harness} forbids claiming or implementing an AFK bead`,
      );
      assert.match(boundary, /never runs? a pipeline stage/i, `${harness} forbids running a pipeline stage`);

      // The boundary this replaces read as a ban on doing anything, which made a
      // legitimate in-task edit a refusal. Its old wording must not come back.
      assert.doesNotMatch(boundary, /never acts/i, `${harness} states no blanket "never acts"`);
      assert.doesNotMatch(
        boundary,
        /do not modify source code/i,
        `${harness} does not forbid code edits`,
      );
    }
  });
});
