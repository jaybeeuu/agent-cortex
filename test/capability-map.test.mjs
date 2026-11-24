// The capability table: `capabilities` (renamed from `tools`) with a per-harness
// `{ name, type }` on every row.
//
// This suite exists to prove the rename and the added `type` changed **nothing a
// harness receives**. The goldens below were captured from token-map.json and the
// two staged installs (`--output <dir>`, both harnesses) at the commit before the
// rename (main c63c65a). They are held literally on
// purpose: any change to a name here changes what a harness receives, which is
// exactly what a mechanical rename may not do.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { composeAgent, isAllTools, loadTokenMap, translateToolList } from "../scripts/lib/compose-agent.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HARNESSES = /** @type {const} */ (["claude", "pi"]);

// ─── Goldens: the pre-rename resolved names ──────────────────────────────────

/** Capability key → the name each harness resolved to before the rename.
 * @type {Record<string, Record<"claude" | "pi", string | null>>} */
const PRE_RENAME_NAMES = {
  bash: { claude: "Bash", pi: "bash" },
  view: { claude: "Read", pi: "read" },
  edit: { claude: "Edit", pi: "edit" },
  create: { claude: "Write", pi: "write" },
  grep: { claude: "Grep", pi: "grep" },
  rg: { claude: "Grep", pi: "grep" },
  glob: { claude: "Glob", pi: "find" },
  ask_user: { claude: "AskUserQuestion", pi: "ask_questions" },
  web_fetch: { claude: "WebFetch", pi: "fetch_content" },
  skill: { claude: "Skill", pi: "read" },
  task: { claude: "Task", pi: "task" },
  read_agent: { claude: null, pi: "read_agent" },
  wait_for_agents: { claude: null, pi: "wait_for_agents" },
  peer_send: { claude: "SendMessage", pi: "peer_send" },
  peer_list: { claude: "ListAgents", pi: "peer_list" },
  post_merge_watch: { claude: "ScheduleWakeup", pi: "post-merge-watch" },
  interrupt_rewind: { claude: "/rewind", pi: "interrupt_resume" },
  interrupt_checkpoint: { claude: null, pi: "interrupt_checkpoint" },
  interrupt_resume: { claude: null, pi: "interrupt_resume" },
  compact_window: { claude: "/compact", pi: "request_compact" },
  flush_window: { claude: "/clear", pi: "request_flush" },
};

/**
 * Agent → harness → the tool list that harness received before the rename.
 * `null` is the all-tools sentinel, which both installers render by omitting the
 * `tools:` line.
 * @type {Record<string, Record<"claude" | "pi", string[] | null>>}
 */
const PRE_RENAME_AGENT_TOOLS = {
  guppi: { claude: null, pi: null },
  plan: {
    claude: ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "AskUserQuestion", "Task", "Skill"],
    pi: ["bash", "read", "edit", "write", "grep", "find", "ask_questions", "task", "read_agent", "read"],
  },
  "ralph-plan": {
    claude: ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "AskUserQuestion"],
    pi: ["bash", "read", "edit", "write", "grep", "find", "ask_questions"],
  },
  ralph: {
    claude: ["Bash", "Read", "Grep", "Glob", "Skill", "Task", "TaskList", "TaskGet", "TaskStop"],
    pi: ["bash", "read", "grep", "find", "task", "read_agent", "wait_for_agents"],
  },
  strategy: {
    claude: ["Bash", "Read", "Grep", "Glob", "AskUserQuestion", "WebFetch", "Skill", "Edit", "Write"],
    pi: ["bash", "read", "grep", "find", "ask_questions", "fetch_content", "read", "edit", "write"],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compose one agent exactly as its installer does for a harness.
 * @param {string} name
 * @param {"claude" | "pi"} harness
 * @returns {Promise<import("../scripts/lib/compose-agent.mjs").ComposedAgent>}
 */
async function renderAgent(name, harness) {
  const options =
    harness === "claude"
      ? { pluginRoot: ROOT, resolveRelativePaths: true, warn: () => {} }
      : { dropNullTools: true, pluginRoot: ROOT, resolveRelativePaths: true, warn: () => {} };
  return composeAgent(ROOT, name, harness, options);
}

/** @returns {Promise<string[]>} */
async function agentNames() {
  const entries = await readdir(join(ROOT, "agents"), { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// ─── The table ───────────────────────────────────────────────────────────────

describe("token-map.json capabilities table", () => {
  it("carries a capability table and no tools table", async () => {
    const raw = JSON.parse(await readFile(join(ROOT, "token-map.json"), "utf-8"));
    assert.ok(raw.capabilities, "capabilities table present");
    assert.equal(raw.tools, undefined, "the tools table is gone, not aliased");
    assert.equal(raw.notes.tools, undefined, "notes moved with the table");
    assert.ok(raw.notes.capabilities, "notes.capabilities present");
  });

  it("binds every harness to { name, type } or null — no string shorthand", async () => {
    const tokenMap = await loadTokenMap(ROOT);
    for (const [key, row] of Object.entries(tokenMap.capabilities)) {
      assert.deepEqual(Object.keys(row).sort(), ["claude", "pi"], `row "${key}" binds both harnesses`);
      for (const harness of HARNESSES) {
        const binding = row[harness];
        if (binding === null) continue;
        assert.equal(typeof binding, "object", `row "${key}" ${harness} is not a bare string`);
        assert.equal(typeof binding.name, "string", `row "${key}" ${harness} names a capability`);
        assert.ok(
          binding.type === "tool" || binding.type === "command",
          `row "${key}" ${harness} has a kind (got ${JSON.stringify(binding.type)})`,
        );
      }
    }
  });

  it("resolves every capability to the name it carried before the rename", async () => {
    const tokenMap = await loadTokenMap(ROOT);
    const keys = Object.keys(tokenMap.capabilities).sort();
    assert.deepEqual(keys, Object.keys(PRE_RENAME_NAMES).sort(), "no row added, renamed or dropped");
    for (const key of keys) {
      for (const harness of HARNESSES) {
        const binding = tokenMap.capabilities[key][harness];
        assert.equal(binding?.name ?? null, PRE_RENAME_NAMES[key][harness], `"${key}" on ${harness}`);
      }
    }
  });

  it("records the kind each harness actually exposes", async () => {
    const { capabilities } = await loadTokenMap(ROOT);
    // Claude Code's slash commands: user-invoked, never model-callable.
    for (const key of ["interrupt_rewind", "compact_window", "flush_window"]) {
      assert.equal(capabilities[key]?.claude?.type, "command", `${key} is a claude command`);
    }
    // pi's ask_questions/request_* /interrupt_* come from extensions as tools.
    for (const key of ["interrupt_resume", "interrupt_checkpoint", "compact_window", "flush_window"]) {
      assert.equal(capabilities[key]?.pi?.type, "tool", `${key} is a pi tool`);
    }
    // The mixed rows: the kind genuinely differs between the harnesses, which is
    // why a row-level kind would be wrong.
    assert.deepEqual(
      { claude: capabilities.flush_window?.claude?.type, pi: capabilities.flush_window?.pi?.type },
      { claude: "command", pi: "tool" },
    );
    assert.deepEqual(
      { claude: capabilities.interrupt_rewind?.claude?.type, pi: capabilities.interrupt_rewind?.pi?.type },
      { claude: "command", pi: "tool" },
    );
    // pi's post-merge-watch is an extension's CLI flag, not a model-callable tool.
    assert.equal(capabilities.post_merge_watch?.pi?.type, "command");
    assert.equal(capabilities.post_merge_watch?.claude?.type, "tool");
  });
});

// ─── What each harness receives ──────────────────────────────────────────────

describe("capability rename — rendered output is unchanged", () => {
  it("keeps every agent's resolved tool list exactly as it was", async () => {
    const tokenMap = await loadTokenMap(ROOT);
    const names = await agentNames();
    assert.deepEqual(names, Object.keys(PRE_RENAME_AGENT_TOOLS).sort(), "every agent covered");
    for (const name of names) {
      for (const harness of HARNESSES) {
        const composed = await composeAgent(ROOT, name, harness, { warn: () => {} });
        const tools = translateToolList(composed.tools, tokenMap, harness, { warn: () => {} });
        const expected = PRE_RENAME_AGENT_TOOLS[name][harness];
        if (expected === null) {
          // Both installers render the sentinel by omitting the `tools:` line.
          assert.deepEqual(tools, ["*"], `${name} on ${harness} still resolves to the all-tools sentinel`);
          assert.ok(isAllTools(tools));
        } else {
          assert.deepEqual(tools, expected, `${name} on ${harness}`);
        }
      }
    }
  });

  it("resolves the capability tokens in agent prose to the same words", async () => {
    // guppi's Context lifecycle and interrupt protocol name a command on one
    // harness and a tool on the other; the prose is identical either way.
    const claudeGuppi = await renderAgent("guppi", "claude");
    assert.match(claudeGuppi.body, /Return to the checkpoint with \/rewind,/);
    assert.match(claudeGuppi.body, /one question at a time with AskUserQuestion/);
    assert.match(claudeGuppi.body, /\n {2}\/clear\./);

    const piGuppi = await renderAgent("guppi", "pi");
    assert.match(piGuppi.body, /Return to the checkpoint with interrupt_resume,/);
    assert.match(piGuppi.body, /one question at a time with ask_questions/);
    assert.match(piGuppi.body, /\n {2}request_flush\./);
    assert.match(piGuppi.body, /mechanism is request_compact\./);
  });

  it("leaves no literal token in any agent on either harness", async () => {
    for (const name of await agentNames()) {
      for (const harness of HARNESSES) {
        const composed = await renderAgent(name, harness);
        assert.doesNotMatch(composed.body, /\{\{(?:CAPABILITY|TOOL|PATH|SECTION):/, `${name} on ${harness}`);
      }
    }
  });
});

// ─── The guard ───────────────────────────────────────────────────────────────

describe("a command in a tool list", () => {
  it("is refused with an error naming the canonical key", async () => {
    const tokenMap = await loadTokenMap(ROOT);
    assert.throws(
      () => translateToolList(["bash", "flush_window"], tokenMap, "claude", { warn: () => {} }),
      /capability "flush_window" is a claude command \(\/clear\) and cannot appear in a tool list/,
    );
  });

  it("allows the same row where the harness exposes a tool", async () => {
    const tokenMap = await loadTokenMap(ROOT);
    assert.deepEqual(translateToolList(["flush_window"], tokenMap, "pi", { warn: () => {} }), ["request_flush"]);
  });

  it("refuses the claude command of a mixed row while allowing the pi tool", async () => {
    const tokenMap = await loadTokenMap(ROOT);
    assert.deepEqual(translateToolList(["interrupt_rewind"], tokenMap, "pi", { warn: () => {} }), [
      "interrupt_resume",
    ]);
    assert.throws(
      () => translateToolList(["interrupt_rewind"], tokenMap, "claude", { warn: () => {} }),
      /capability "interrupt_rewind" is a claude command \(\/rewind\)/,
    );
  });

  it("still omits a null binding rather than refusing it", async () => {
    const tokenMap = await loadTokenMap(ROOT);
    const warnings = /** @type {string[]} */ ([]);
    assert.deepEqual(
      translateToolList(["bash", "read_agent"], tokenMap, "claude", { warn: (m) => warnings.push(m) }),
      ["Bash"],
    );
    assert.ok(warnings.some((w) => w.includes('capability "read_agent"')), "the omission is reported");
  });
});
