// guppi's flush rule is forked at install time, not in two agent files: one
// authored body renders Claude Code's `/clear` on claude and pi's `/new`
// session switch on pi. These tests stage both installs and read the rendered
// agent, so a harness that loses its mechanism — or a null column that drops the
// token and leaves the sentence short of a name — fails here instead of shipping
// a rule the session cannot act on. Both stages go to workspaces under a
// per-process temp root that a file-level after() hook removes, and the
// checkout's own sources are never read as the artefact under test except for
// the token map row itself.

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

const WORK_UNIT = "## The work unit";
const LIFECYCLE = "## Context lifecycle";
const PLACEHOLDER = "<CLEAR-WINDOW>";

/** Where each harness materialises the composed agent.
 * @type {Record<"pi" | "claude", string[]>} */
const AGENT_PATH = {
  pi: ["agents", "guppi.agent.md"],
  claude: ["agents", "guppi.md"],
};

/** The flush mechanism each harness must name, and the other's name it must
 * not. Neither column may be null: a dropped token would leave the sentence
 * that named the mechanism short of one.
 * @type {Record<"pi" | "claude", { own: string, other: string }>} */
const MECHANISM = {
  pi: { own: "/new", other: "/clear" },
  claude: { own: "/clear", other: "/new" },
};

/** @type {ReturnType<typeof createTempRoot>} */
const tempRoot = createTempRoot("agent-cortex-guppi-flush-");

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
 * @param {string} heading  literal heading text, e.g. "## Context lifecycle"
 * @returns {string} */
function section(doc, heading) {
  const start = doc.indexOf(heading);
  assert.notEqual(start, -1, `heading "${heading}" is missing`);
  const depth = /** @type {number} */ (heading.match(/^#+/)?.[0].length);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${depth}} `));
  return next === -1 ? rest : rest.slice(0, next);
}

/** Count the non-overlapping occurrences of `needle` in `haystack`.
 * @param {string} haystack
 * @param {string} needle
 * @returns {number} */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

describe("guppi's flush rule renders the harness's own mechanism", () => {
  it("maps the clear window to a command on both harnesses, never null", async () => {
    const map = JSON.parse(await readFile(join(ROOT, "token-map.json"), "utf-8"));

    assert.deepEqual(
      map.tools.clear_window,
      { claude: "/clear", pi: "/new" },
      "clear_window maps a command on both harnesses",
    );
  });

  it("names the harness's own mechanism in the lifecycle, and never the other's", async () => {
    const { pi, claude } = await stageBoth();

    /** @type {Record<"pi" | "claude", string>} */
    const agents = { pi, claude };

    for (const harness of /** @type {const} */ (["pi", "claude"])) {
      const lifecycle = section(agents[harness], LIFECYCLE);
      const { own, other } = MECHANISM[harness];

      assert.ok(
        lifecycle.includes(own),
        `${harness} names its flush mechanism as ${own}`,
      );
      assert.equal(count(lifecycle, other), 0, `the ${harness} lifecycle names no ${other}`);
      // The mechanism is named in the rule and again in the ask, so a flush
      // cannot be described once and left unnamed where it is requested.
      assert.equal(count(lifecycle, own), 2, `${harness} names ${own} in the rule and in the ask`);
      assert.doesNotMatch(
        agents[harness],
        /\{\{(?:TOOL|PATH|SECTION):/,
        `${harness} agent carries no literal token`,
      );
      assert.doesNotMatch(agents[harness], /agnt-ctx-/, `the ${harness} agent names no internal bead`);
    }
  });

  it("keeps the lifecycle identical once the mechanism name is set aside", async () => {
    const { pi, claude } = await stageBoth();

    // Replacing the harness's own name with one placeholder means a dropped
    // token — a null column, or a renamed key — leaves the two renders
    // different instead of both quietly losing a word.
    const normalise = (/** @type {string} */ doc) => {
      const harness = doc === pi ? "pi" : "claude";
      const { own } = MECHANISM[/** @type {"pi" | "claude"} */ (harness)];
      const lifecycle = section(doc, LIFECYCLE);
      assert.ok(lifecycle.includes(own), `the lifecycle names ${own} before it is normalised`);
      return lifecycle.split(own).join(PLACEHOLDER);
    };

    assert.equal(
      normalise(pi),
      normalise(claude),
      "the flush rule is the same text apart from the mechanism name",
    );
  });

  it("states the flush rule against any reset that drops the window", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const lifecycle = flat(section(doc, LIFECYCLE));

      // The rule is written against the effect, not the command, so a later
      // mechanism swap does not rewrite it.
      assert.match(
        lifecycle,
        /any reset that drops the window/i,
        `${harness} writes the rule against any reset that drops the window`,
      );
      assert.match(
        lifecycle,
        /flushed at every boundary that leaves the theme/i,
        `${harness} states the trigger`,
      );
      assert.match(lifecycle, /a \*\*switch\*\* or a \*\*move\*\*, never a \*\*stay\*\*/i, `${harness} names which boundary flushes`);
    }
  });

  it("triggers the flush from the boundary decision, and keeps the window on a stay", async () => {
    const { pi, claude } = await stageBoth();

    // The trigger is one paragraph of the work unit; the rest of the section
    // names a skill path, which legitimately differs per harness.
    const trigger = (/** @type {string} */ doc) => {
      const workUnit = flat(section(doc, WORK_UNIT));
      const start = workUnit.indexOf("The answer decides the window.");
      assert.notEqual(start, -1, "the work unit states what the boundary decision does to the window");
      return workUnit.slice(start, workUnit.indexOf("carries the flush rule.") + "carries the flush rule.".length);
    };

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const response = trigger(doc);

      assert.match(
        response,
        /a \*\*stay\*\* keeps it, because the next item on the theme needs what the last one established/i,
        `${harness} keeps the window on a stay, and says why`,
      );
      assert.match(
        response,
        /a \*\*switch\*\* or a \*\*move\*\* ends the session's hold on the theme/i,
        `${harness} ends the theme on a switch or a move`,
      );
      assert.match(
        response,
        /boundary is also a flush: write the memory, then clear the window, before the next item starts/i,
        `${harness} flushes memory-first before the next item`,
      );
    }

    // The trigger is a property of the boundary, not of a harness, so both
    // renders carry the same words.
    assert.equal(trigger(pi), trigger(claude), "both harnesses state the trigger the same way");
  });

  it("keeps the three parts and the double write, and makes the ask mandatory", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const memory = flat(section(doc, LIFECYCLE));

      for (const part of ["**What was decided**", "**What is open**", "**What the next session needs**"]) {
        assert.ok(memory.includes(part), `${harness} keeps the "${part}" part`);
      }
      assert.match(memory, /write the three parts twice/i, `${harness} writes the three parts twice`);
      // One write to the trail, one to the memory: the two reads the same
      // three parts serve.
      assert.ok(memory.includes("bd note <bead-id>"), `${harness} writes the three parts to the trail`);
      assert.ok(
        memory.includes('bd remember "<the same three parts>" --key <theme-slug>'),
        `${harness} writes the same three parts to the memory`,
      );

      // The defect the parent bug recorded was an ask that never happened, so
      // the ask is mandatory and carries each of its four pieces.
      assert.match(memory, /a flush with no memory write is a defect/i, `${harness} keeps the defect rule`);
      assert.match(memory, /the theme is paused/i, `${harness} says the theme is paused`);
      assert.match(memory, /the theme bead is `<epic-id>`/i, `${harness} names the theme bead`);
      assert.match(memory, /the theme bead is `<epic-id>`, run [^,]+, and the next session reads that bead first/i, `${harness} names the bead, the command and the first read`);
      assert.match(memory, /never leave the ask unsaid/i, `${harness} makes the ask mandatory`);
    }
  });

  it("uses no unresolved token and names no harness outside its own render", async () => {
    const { pi, claude } = await stageBoth();

    /** @type {Array<["pi" | "claude", string]>} */
    const agents = [["pi", pi], ["claude", claude]];

    for (const [harness, doc] of agents) {
      const { own, other } = MECHANISM[harness];

      // The whole document, not one section: a mechanism name written into the
      // shared body outside the lifecycle renders into the other harness just
      // the same, so a section-scoped check would not see it. The lifecycle
      // keeps its own narrower promise above.
      assert.ok(doc.includes(own), `${harness} names its own mechanism ${own} in the document`);
      assert.equal(count(doc, other), 0, `the ${harness} document names no ${other}`);

      // The name of this test claims "no unresolved token", so it checks the
      // whole token grammar rather than the one key it was written for.
      assert.doesNotMatch(doc, /\{\{(?:TOOL|PATH|SECTION):/, `${harness} carries no unresolved token`);
      assert.doesNotMatch(doc, /\{\{TOOL:clear_window\}\}/, `${harness} resolves the clear-window token`);
      assert.doesNotMatch(doc, /\bwith\s{2,}/, `${harness} agent has no dropped-name gap`);
    }
  });
});
