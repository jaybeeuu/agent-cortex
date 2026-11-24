// guppi's window transitions are forked at install time, not in two agent files:
// one authored body renders each harness's own mechanism for a staying window and
// for a leaving one. These tests stage both installs and read the rendered agent,
// so a harness that loses a mechanism — or a null column that drops a token and
// leaves the sentence short of a name — fails here instead of shipping a rule the
// session cannot act on. Both stages go to workspaces under a per-process temp
// root that a file-level after() hook removes, and the checkout's own sources are
// never read as the artefact under test except for the token map rows themselves.

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

/** Where each harness materialises the composed agent.
 * @type {Record<"pi" | "claude", string[]>} */
const AGENT_PATH = {
  pi: ["agents", "guppi.agent.md"],
  claude: ["agents", "guppi.md"],
};

/** The mechanism each harness must name for each transition, and the other
 * harness's names it must not. Neither column may be null: a dropped token would
 * leave the sentence that named the mechanism short of one.
 * @type {Record<"pi" | "claude", { compact: string, flush: string }>} */
const MECHANISM = {
  pi: { compact: "request_compact", flush: "request_flush" },
  claude: { compact: "/compact", flush: "/clear" },
};

/** Placeholders that stand in for a harness's own mechanism names, so the two
 * renders can be compared word for word.
 * @type {Record<"compact" | "flush", string>} */
const PLACEHOLDER = {
  compact: "<COMPACT-WINDOW>",
  flush: "<FLUSH-WINDOW>",
};

/** The mechanisms the old rule named, which no render may mention again. */
const RETIRED = ["/new", "clear_window"];

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

describe("guppi's window transitions render each harness's own mechanism", () => {
  it("maps a stay to a compaction and a switch to a flush, on both harnesses, never null", async () => {
    const map = JSON.parse(await readFile(join(ROOT, "token-map.json"), "utf-8"));

    assert.deepEqual(
      map.capabilities.compact_window,
      { claude: { name: "/compact", type: "command" }, pi: { name: "request_compact", type: "tool" } },
      "a stay names a compaction on both harnesses",
    );
    assert.deepEqual(
      map.capabilities.flush_window,
      { claude: { name: "/clear", type: "command" }, pi: { name: "request_flush", type: "tool" } },
      "a switch names a flush on both harnesses",
    );
    assert.equal(
      "clear_window" in map.capabilities,
      false,
      "the row the old rule named is gone, so no rendered text can resolve it",
    );
    assert.equal(
      JSON.stringify(map).includes("/new"),
      false,
      "the map names no session switch as a transition mechanism",
    );
  });

  it("names the harness's own mechanism for each transition, and never the other's", async () => {
    const { pi, claude } = await stageBoth();

    /** @type {Record<"pi" | "claude", string>} */
    const agents = { pi, claude };

    for (const harness of /** @type {const} */ (["pi", "claude"])) {
      const lifecycle = section(agents[harness], LIFECYCLE);
      const own = MECHANISM[harness];
      const other = MECHANISM[harness === "pi" ? "claude" : "pi"];

      for (const transition of /** @type {const} */ (["compact", "flush"])) {
        assert.ok(
          lifecycle.includes(own[transition]),
          `${harness} names its ${transition} mechanism as ${own[transition]}`,
        );
        assert.equal(
          count(lifecycle, other[transition]),
          0,
          `the ${harness} lifecycle names no ${other[transition]}`,
        );
      }
    }
  });

  it("keeps the lifecycle identical once the two mechanism names are set aside", async () => {
    const { pi, claude } = await stageBoth();

    // Replacing each harness's own names with one placeholder means a dropped
    // token — a null column, or a renamed key — leaves the two renders different
    // instead of both quietly losing a word.
    /** @param {"pi" | "claude"} harness @param {string} doc */
    const normalise = (harness, doc) => {
      const own = MECHANISM[harness];
      let lifecycle = section(doc, LIFECYCLE);
      for (const transition of /** @type {const} */ (["compact", "flush"])) {
        assert.ok(lifecycle.includes(own[transition]), `the lifecycle names ${own[transition]}`);
        lifecycle = lifecycle.split(own[transition]).join(PLACEHOLDER[transition]);
      }
      return lifecycle;
    };

    assert.equal(
      normalise("pi", pi),
      normalise("claude", claude),
      "the two transitions are the same text apart from the mechanism names",
    );
  });

  it("states what each outcome does to the window, and why", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const lifecycle = flat(section(doc, LIFECYCLE));

      assert.match(
        lifecycle,
        /a \*\*stay\*\* compacts the window: it summaris\w+ what the item established and keeps the recent tail/i,
        `${harness} compacts on a stay, and says why`,
      );
      assert.match(
        lifecycle,
        /a \*\*switch\*\* flushes the window: it drops the window and carries nothing across/i,
        `${harness} flushes on a switch, and carries nothing`,
      );
      assert.match(
        lifecycle,
        /the next item on the theme continues from it without the raw turns that produced it/i,
        `${harness} says what a stay buys the next item`,
      );
      assert.match(
        lifecycle,
        /a summary of the theme just left is the noise the flush exists to remove/i,
        `${harness} says why a switch keeps no summary`,
      );
    }
  });

  it("cross-references the interrupts section instead of rebuilding the rewind", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const lifecycle = flat(section(doc, LIFECYCLE));

      assert.match(
        lifecycle,
        /an \*\*interrupt\*\* rewinds — \*\*Interrupts\*\*, below, owns that protocol/i,
        `${harness} points at the interrupts section that owns the rewind`,
      );
      assert.match(
        lifecycle,
        /it is not a third outcome at a boundary/i,
        `${harness} keeps the rewind out of the boundary vocabulary`,
      );
      // The rewind lives in one place. Its mechanism belongs to that section.
      for (const rewind of ["interrupt_rewind", "/rewind", "interrupt_resume"]) {
        assert.equal(count(lifecycle, rewind), 0, `${harness} leaves the rewind mechanism to its own section`);
      }
    }
  });

  it("carries no handoff into the replacement session", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const lifecycle = flat(section(doc, LIFECYCLE));

      assert.match(
        lifecycle,
        /\*\*A flush carries no handoff\.\*\* The replacement session is seeded with nothing/i,
        `${harness} states that a flush seeds nothing`,
      );
      assert.match(
        lifecycle,
        /no summary of the session that ended, and no theme id/i,
        `${harness} names both things a flush must not carry`,
      );
      assert.match(
        lifecycle,
        /its own \*\*Session start\*\* re-establishes the rubric and the queue/i,
        `${harness} says where the next session gets its bearings`,
      );
      // A memory keyed by theme is a handoff by another name: the tracker trail is
      // the whole record, and the next session reads it under its own rules.
      assert.equal(
        count(lifecycle, "bd remember"),
        0,
        `${harness} seeds no theme memory across a flush`,
      );
    }
  });

  it("asks for two outcomes, and counts a theme's second item as a stay", async () => {
    const { pi, claude } = await stageBoth();

    /** The decision paragraph, which is a property of the boundary and therefore
     * carries no path or mechanism token that could legitimately differ.
     * @param {string} doc */
    const decision = (doc) => {
      const workUnit = flat(section(doc, WORK_UNIT));
      const start = workUnit.indexOf("At each boundary,");
      assert.notEqual(start, -1, "the work unit states the boundary decision");
      const end = workUnit.indexOf("states both.") + "states both.".length;
      return workUnit.slice(start, end);
    };

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const trigger = decision(doc);

      assert.match(
        trigger,
        /ask for one of \*\*two\*\* outcomes — \*\*stay\*\*, or \*\*switch\*\* because higher-priority work waits elsewhere/i,
        `${harness} asks for two outcomes`,
      );
      assert.match(
        trigger,
        /the decision is about the next \*\*theme\*\*, never the next item/i,
        `${harness} anchors the decision on the theme`,
      );
      assert.match(
        trigger,
        /taking a theme's second item because its first is blocked is an ordinary \*\*stay\*\*/i,
        `${harness} makes a blocked first item an ordinary stay`,
      );
      assert.match(
        trigger,
        /a \*\*stay\*\* compacts it[\s\S]*?a \*\*switch\*\* flushes it/i,
        `${harness} gives each outcome its transition`,
      );

      // The mechanism is named once, in the lifecycle. The decision states the
      // effect, so the two harness names appear nowhere in it.
      for (const mechanism of [MECHANISM.pi.compact, MECHANISM.pi.flush]) {
        assert.equal(count(trigger, mechanism), 0, `${harness} names no mechanism in the decision`);
      }
    }

    assert.equal(decision(pi), decision(claude), "both harnesses state the decision the same way");
  });

  it("retires the move outcome and the old mechanism from every render", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      // Whole document, not one section: a retired word written into the shared
      // body outside the lifecycle renders into the other harness just the same.
      assert.equal(count(doc, "**move**"), 0, `the ${harness} render names no move outcome`);
      assert.equal(count(doc, "a **switch** or a **move**"), 0, `the ${harness} render keeps no move clause`);
      for (const retired of RETIRED) {
        assert.equal(count(doc, retired), 0, `the ${harness} render names no ${retired}`);
      }
      assert.doesNotMatch(doc, /\{\{(?:CAPABILITY|PATH|SECTION):/, `${harness} carries no unresolved token`);
      assert.doesNotMatch(doc, /\bwith\s{2,}/, `${harness} agent has no dropped-name gap`);
      assert.doesNotMatch(doc, /agnt-ctx-/, `the ${harness} agent names no internal bead`);
    }
  });
});
