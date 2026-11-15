// guppi's interrupt protocol is forked at install time, not in two agent files:
// one authored body renders this package's own `interrupt_resume` tool on pi and
// Claude Code's built-in `/rewind` command on claude. These tests stage both
// installs and read the rendered agent, so a harness that loses its mechanism
// fails here instead of leaving a dangling sentence. Both stages go to
// workspaces under a per-process temp root that a file-level after() hook
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

const HEADING = "## Interrupts";
const PLACEHOLDER = "<REWIND>";

/** Where each harness materialises the composed agent.
 * @type {Record<"pi" | "claude", string[]>} */
const AGENT_PATH = {
  pi: ["agents", "guppi.agent.md"],
  claude: ["agents", "guppi.md"],
};

/** The rewind mechanism each harness must name, and the other's name it must
 * not. The checkpoint half is deliberately not tokenised: claude checkpoints on
 * its own while pi takes a tool call, and a null column would drop a name and
 * leave a broken sentence.
 * @type {Record<"pi" | "claude", { own: string, other: string }>} */
const MECHANISM = {
  pi: { own: "interrupt_resume", other: "/rewind" },
  claude: { own: "/rewind", other: "interrupt_resume" },
};

/** @type {ReturnType<typeof createTempRoot>} */
const tempRoot = createTempRoot("agent-cortex-interrupt-");

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
 * @returns {Promise<{ pi: string, claude: string, dirs: Record<"pi" | "claude", string>, stdout: string }>} */
let staged = null;
function stageBoth() {
  staged ??= (async () => {
    /** @type {Record<string, string>} */
    const rendered = {};
    /** @type {Record<string, string>} */
    const dirs = {};
    /** @type {string[]} */
    const output = [];
    for (const harness of /** @type {const} */ (["pi", "claude"])) {
      const out = await tempRoot.createWorkspace();
      const result = await runCli(["install", harness, "--output", out]);
      assert.equal(result.exitCode, 0, `install ${harness} failed: ${result.stdout}${result.stderr}`);
      output.push(result.stdout, result.stderr);
      dirs[harness] = out;
      rendered[harness] = await readFile(join(out, ...AGENT_PATH[harness]), "utf-8");
    }
    return { ...rendered, dirs: /** @type {Record<"pi" | "claude", string>} */ (dirs), stdout: output.join("\n") };
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
 * @param {string} heading  literal heading text, e.g. "## Interrupts"
 * @returns {string} */
function section(doc, heading) {
  const start = doc.indexOf(heading);
  assert.notEqual(start, -1, `heading "${heading}" is missing`);
  const depth = /** @type {number} */ (heading.match(/^#+/)?.[0].length);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${depth}} `));
  return next === -1 ? rest : rest.slice(0, next);
}

describe("guppi's interrupt protocol renders per harness", () => {
  it("states the four steps in order, record before rewind", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const protocol = section(doc, HEADING);

      const steps = ["**Checkpoint.**", "**Record.**", "**Rewind.**", "**Resume.**"];
      const positions = steps.map((step) => protocol.indexOf(step));
      for (const [index, position] of positions.entries()) {
        assert.notEqual(position, -1, `${harness} states ${steps[index]}`);
      }
      assert.deepEqual(
        [...positions].sort((a, b) => a - b),
        positions,
        `${harness} states the steps in the order checkpoint, record, rewind, resume`,
      );

      // The order is the protocol, so it is asserted as a rule and not left to
      // the reader to infer from sentence order.
      assert.match(flat(protocol), /record before you rewind/i, `${harness} states record-before-rewind`);
    }
  });

  it("names the harness's own rewind mechanism, only that one, and hands a human-only rewind to the human", async () => {
    const { pi, claude } = await stageBoth();

    /** @type {Record<string, string>} */
    const protocols = { pi: section(pi, HEADING), claude: section(claude, HEADING) };

    for (const harness of /** @type {const} */ (["pi", "claude"])) {
      const protocol = protocols[harness];
      const { own, other } = MECHANISM[harness];

      assert.ok(
        protocol.includes(`with ${own},`),
        `${harness} interrupt protocol names its rewind as ${own}`,
      );
      assert.equal(protocol.split(own).length - 1, 1, `${harness} names ${own} exactly once`);
      assert.ok(!protocol.includes(other), `the ${harness} protocol names no ${other}`);

      // The values differ in kind, so the rewind is not always the agent's to
      // perform: where the harness supplies a user command, the protocol must
      // hand it to the human rather than claim it.
      assert.match(
        flat(protocol),
        /where the harness gives that to the human and not to you/i,
        `${harness} hands a human-only rewind to the human`,
      );
      assert.match(
        flat(protocol),
        /never report a rewind you did not make/i,
        `${harness} forbids claiming a rewind the agent did not make`,
      );
    }
  });

  it("grants pi's guppi every interrupt tool the staged extension registers", async () => {
    const { dirs } = await stageBoth();

    // Both sides are read from the same staged pi package: the extension is the
    // collaborator that registers the tools, the agent's frontmatter is the
    // wiring that declares them to the model. A rename on either side leaves
    // guppi unable to run steps 1 and 3, so it fails here.
    const extension = await readFile(join(dirs.pi, "extensions", "interrupt-bookmark", "index.ts"), "utf-8");
    const registered = [...extension.matchAll(/^export const (?:CHECKPOINT|RESUME)_TOOL = "([^"]+)";$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(
      [...registered].sort(),
      ["interrupt_checkpoint", "interrupt_resume"],
      "the staged extension registers both interrupt tools",
    );

    const declared = /** @type {string} */ (
      (await readFile(join(dirs.pi, ...AGENT_PATH.pi), "utf-8")).match(/^tools: "([^"]+)"$/m)?.[1]
    ).split(", ");

    for (const tool of registered) {
      assert.ok(declared.includes(tool), `pi's guppi declares ${tool}`);
    }
  });

  it("keeps the protocol text identical once the mechanism name is set aside", async () => {
    const { pi, claude } = await stageBoth();

    // Replacing the harness's own name with one placeholder means a dropped
    // token — a null column, or a renamed key — leaves the two renders
    // different instead of both quietly losing a word.
    const normalise = (/** @type {string} */ doc, /** @type {string} */ own) => {
      const protocol = section(doc, HEADING);
      assert.ok(protocol.includes(own), `the protocol names ${own} before it is normalised`);
      return protocol.replace(own, PLACEHOLDER);
    };

    assert.equal(
      normalise(pi, MECHANISM.pi.own),
      normalise(claude, MECHANISM.claude.own),
      "the interrupt protocol is the same text apart from the mechanism name",
    );
  });

  it("states the rewind fallback, the resume sentence and the two constraints in both renders", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const protocol = flat(section(doc, HEADING));

      // A failed rewind must not become a silent carry: the protocol says what
      // to do instead, in the same words on both harnesses.
      assert.match(protocol, /rewind fails, continue in the current context and say so plainly/i, `${harness} states the rewind fallback`);
      // The resumed task is named, not implied, and the record's id goes with it.
      assert.ok(protocol.includes("back to <task> — recorded <what> as <bead id>"), `${harness} states the resume sentence`);
      assert.match(protocol, /Never delete the abandoned branch/i, `${harness} keeps the branch`);
      assert.match(protocol, /never into a scratch file/i, `${harness} records to a bead, not a file`);
    }
  });

  it("maps each interrupt kind onto a concrete bead type", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const protocol = section(doc, HEADING);

      // The kinds from the problem map through the existing triage rule, which
      // the protocol points at rather than restates.
      for (const [kind, beadType] of [
        ["A meeting note", "`record-idea`"],
        ["PR feedback to pass on", "`handoff`"],
        ["A Slack todo", "`create-task`"],
      ]) {
        const row = protocol.split("\n").find((line) => line.startsWith(`| ${kind} |`));
        assert.ok(row, `${harness} maps "${kind}"`);
        assert.ok(/** @type {string} */ (row).includes(beadType), `${harness} maps "${kind}" onto ${beadType}`);
      }
      // The rule lives in the planning skills; naming them is the pointer.
      for (const skill of ["`create-task`", "`record-idea`", "`classify-bead`"]) {
        assert.ok(protocol.includes(skill), `${harness} points at ${skill}`);
      }
    }
  });

  it("leaves no surviving token and no dropped-name prose in either render", async () => {
    const { pi, claude, stdout } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      assert.doesNotMatch(doc, /\{\{TOOL:|\{\{PATH:|\{\{SECTION:/, `${harness} agent carries no literal token`);
      // A null mapping drops the token and leaves its sentence missing a name;
      // the shipped source must therefore never rely on one.
      assert.doesNotMatch(doc, /\bwith\s{2,}/, `${harness} agent has no dropped-name gap`);
      assert.doesNotMatch(doc, /\bwith\s*[,;]/, `${harness} agent has no dropped-name gap`);
    }
    assert.doesNotMatch(stdout, /has no (?:claude|pi) mapping/, "no shipped agent uses a null-mapped tool token");
  });
});
