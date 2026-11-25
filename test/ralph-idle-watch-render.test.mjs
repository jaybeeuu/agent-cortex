// ralph's idle watch is forked at install time, not in two agent files: one
// authored body renders this package's own `idle_watch` tool on pi and Claude
// Code's built-in `ScheduleWakeup` tool on claude. These tests stage both
// installs and read the rendered ralph agent, so a harness that loses its wake
// mechanism fails here instead of leaving ralph silently idle. Both stages go to
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

const HEADING = "## Idle watch";
const FALLBACK_HEADING = "### A session with no such mechanism";
const PLACEHOLDER = "<WAKE>";

/** Where each harness materialises the composed agent.
 * @type {Record<"pi" | "claude", string[]>} */
const AGENT_PATH = {
  pi: ["agents", "ralph.agent.md"],
  claude: ["agents", "ralph.md"],
};

/** The wake mechanism each harness must name, and the other's name it must not.
 * @type {Record<"pi" | "claude", { own: string, other: string }>} */
const MECHANISM = {
  pi: { own: "idle_watch", other: "ScheduleWakeup" },
  claude: { own: "ScheduleWakeup", other: "idle_watch" },
};

/** @type {ReturnType<typeof createTempRoot>} */
const tempRoot = createTempRoot("agent-cortex-idle-watch-");

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

/** Stage both installs once and read their rendered ralph agents.
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

/** One markdown section: from its heading up to the next heading of the same or a
 * shallower depth.
 * @param {string} doc
 * @param {string} heading  literal heading text, e.g. "## Idle watch"
 * @returns {string} */
function section(doc, heading) {
  const start = doc.indexOf(heading);
  assert.notEqual(start, -1, `heading "${heading}" is missing`);
  const depth = /** @type {number} */ (heading.match(/^#+/)?.[0].length);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${depth}} `));
  return next === -1 ? rest : rest.slice(0, next);
}

/** Everything but the frontmatter and the per-harness wake section: the parts
 * both harnesses must receive as one authored copy.
 * @param {string} doc
 * @returns {string} */
function sharedPart(doc) {
  const withoutFrontmatter = doc.replace(/^---\n[\s\S]*?\n---\n/, "");
  return withoutFrontmatter.replace(/## Wake mechanism[\s\S]*?\n---\n/, "<WAKE>\n---\n");
}

describe("ralph's idle watch renders per harness", () => {
  it("names the harness's own wake mechanism once and the other's not at all", async () => {
    const { pi, claude } = await stageBoth();

    /** @type {Record<string, string>} */
    const policies = { pi: section(pi, HEADING), claude: section(claude, HEADING) };

    for (const harness of /** @type {const} */ (["pi", "claude"])) {
      const policy = policies[harness];
      const { own, other } = MECHANISM[harness];

      assert.ok(policy.includes(own), `${harness} names its wake mechanism as ${own}`);
      assert.equal(policy.split(own).length - 1, 1, `${harness} names ${own} exactly once`);
      assert.ok(!policy.includes(other), `the ${harness} policy names no ${other}`);
    }
  });

  it("keeps the policy identical once the mechanism name is set aside", async () => {
    const { pi, claude } = await stageBoth();

    // Replacing the harness's own name with one placeholder means a dropped
    // token — a null column, or a renamed key — leaves the two renders
    // different instead of both quietly losing a word.
    const normalise = (/** @type {string} */ doc, /** @type {string} */ own) => {
      const policy = section(doc, HEADING);
      assert.ok(policy.includes(own), `the policy names ${own} before it is normalised`);
      return policy.replace(own, PLACEHOLDER);
    };

    assert.equal(
      normalise(pi, MECHANISM.pi.own),
      normalise(claude, MECHANISM.claude.own),
      "the idle policy is the same text apart from the mechanism name",
    );
  });

  it("states the arming condition, the inspection rule and the status fields in both renders", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const policy = section(doc, HEADING);

      // The arming condition is the rule the epic exists for: arm on an empty
      // queue, and only when nothing is in flight. Both halves are asserted,
      // because either one alone arms a watch over work that is waiting.
      assert.match(policy, /Arm it only when both conditions hold/, `${harness} states one arming condition`);
      assert.match(policy, /`bd ready -l execution:afk` returns nothing dispatchable/, `${harness} arms on an empty queue`);
      assert.match(policy, /holds no stage, decomposition or expansion worker/, `${harness} arms on an idle inflight`);
      assert.match(policy, /Never at startup\./, `${harness} forbids arming at startup`);

      // A stalled bead is read before it is touched, and re-arming is what
      // refills the mechanism's budget after acting.
      assert.match(policy, /Inspect each stalled id before touching it/, `${harness} inspects a stalled bead`);
      assert.match(policy, /arm again/, `${harness} re-arms after acting`);

      // The status line is three rows, one per fact ralph must report.
      for (const field of ["| Watching |", "| Last check |", "| Nudges |"]) {
        assert.ok(policy.includes(field), `${harness} reports the ${field.trim()} field`);
      }
    }
  });

  it("states the no-watcher fallback without naming a mechanism", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      const fallback = section(doc, FALLBACK_HEADING);

      // A session with no watch mechanism must be told what to do instead, and
      // the fallback must not itself depend on the mechanism: naming it there
      // would leave the paragraph meaningless wherever it is missing.
      assert.match(fallback, /runs the check once/, `${harness} states the one-shot check`);
      assert.match(fallback, /waits for the user/, `${harness} states that the prompt is the clock`);
      assert.match(fallback, /never fakes a cadence with `sleep`/, `${harness} rejects a fake cadence`);
      assert.ok(!fallback.includes(MECHANISM.pi.own), `the ${harness} fallback names no pi tool`);
      assert.ok(!fallback.includes(MECHANISM.claude.own), `the ${harness} fallback names no claude tool`);
    }
  });

  it("lists the mechanism in ralph's tool allowlist so the model can arm it", async () => {
    const { pi, claude } = await stageBoth();

    // The allowlist is what decides whether the model can call the mechanism: a
    // rename on either side would leave ralph unable to arm the watch it is told
    // to arm, and the policy would be prose it cannot act on.
    const allowlist = (/** @type {string} */ doc) => doc.match(/^tools:.*$/m)?.[0] ?? "";
    assert.match(allowlist(pi), /\bidle_watch\b/, "pi's ralph can call idle_watch");
    assert.match(allowlist(claude), /\bScheduleWakeup\b/, "claude's ralph can call ScheduleWakeup");
  });

  it("keeps the rest of ralph identical outside the per-harness wake section", async () => {
    const { pi, claude } = await stageBoth();

    // The fork is one row, so everything else in the agent — the event loop, the
    // two idle endings that arm the watch, the HITL pause and the shutdown — is
    // one authored copy.
    const normalised = (/** @type {string} */ doc, /** @type {string} */ own) =>
      sharedPart(doc).replace(own, PLACEHOLDER);

    assert.equal(
      normalised(pi, MECHANISM.pi.own),
      normalised(claude, MECHANISM.claude.own),
      "the shared agent body is identical apart from the mechanism name",
    );
  });

  it("leaves no surviving token and no dropped-name prose in either render", async () => {
    const { pi, claude, stdout } = await stageBoth();

    for (const [harness, doc] of [["pi", pi], ["claude", claude]]) {
      assert.doesNotMatch(doc, /\{\{CAPABILITY:|\{\{PATH:|\{\{SECTION:/, `${harness} agent carries no literal token`);
      // A null mapping drops the token and leaves its sentence missing a name;
      // the shipped source must therefore never rely on one.
      assert.doesNotMatch(doc, /\bwith\s{2,}/, `${harness} agent has no dropped-name gap`);
      assert.doesNotMatch(doc, /\bwith\s*[,;]/, `${harness} agent has no dropped-name gap`);
    }
    assert.doesNotMatch(stdout, /has no (?:claude|pi) mapping/, "no shipped agent uses a null-mapped token");
  });
});
