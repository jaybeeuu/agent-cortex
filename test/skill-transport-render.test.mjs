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
 * @returns {Promise<{ pi: Record<string, string>, claude: Record<string, string>, roots: Record<string, string>, stdout: string, stderr: string }>} */
let staged = null;
function stageBoth() {
  staged ??= (async () => {
    /** @type {Record<string, Record<string, string>>} */
    const rendered = {};
    /** @type {Record<string, string>} */
    const roots = {};
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
      roots[harness] = out;
    }
    return { ...rendered, roots, stdout: output.join("\n"), stderr: "" };
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

/** One list bullet: from its bold heading up to the next bullet.
 * @param {string} doc
 * @param {string} heading  literal bullet heading, e.g. "- **HITL Pause**"
 * @returns {string} */
function bullet(doc, heading) {
  const start = doc.indexOf(heading);
  assert.notEqual(start, -1, `bullet "${heading}" is missing`);
  const rest = doc.slice(start + heading.length);
  const next = rest.indexOf("\n- **");
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

  it("reports a human gate on the harness's own channel in both renders, never PI only", async () => {
    const { pi, claude } = await stageBoth();

    for (const [harness, doc] of [["pi", pi.ralphSkill], ["claude", claude.ralphSkill]]) {
      const report = section(doc, "### 7. HITL pause and shutdown");
      const sends = [bullet(report, "- **HITL Pause**"), bullet(report, "- **Shutdown**")].join("\n");

      // Both sends tokenise to this harness's own mechanism, so a claim that the
      // channel belongs to pi alone is pre-fork text that survived materialisation.
      // The leading \b keeps an unrelated "API only" out of the match.
      assert.doesNotMatch(sends, /\bPI[-\s]only\b/i, `the ${harness} render states no PI-only peer channel`);
    }
  });

  it("ships no harness version in the token map's descriptions", async () => {
    const { roots } = await stageBoth();
    const tokenMap = JSON.parse(await readFile(join(roots.pi, "token-map.json"), "utf-8"));

    // token-map.json is in the published files whitelist, so a pinned harness
    // version ships to every consumer and goes stale there, misleadingly. The
    // harness-agnostic facts belong in prose that dates itself instead.
    for (const [group, notes] of Object.entries(tokenMap.notes)) {
      for (const [key, text] of Object.entries(notes)) {
        assert.equal(typeof text, "string", `notes.${group}.${key} is a description string`);
        assert.doesNotMatch(text, /\b\d+\.\d+\.\d+\b/, `notes.${group}.${key} pins no harness version`);
      }
    }

    // The rename the peer_list description exists to record survives the reword.
    assert.match(tokenMap.notes.tools.peer_list, /\bListPeers\b/, "peer_list still records the ListPeers rename");
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

  it("sends ralph's reports on pi without waiting for an answer and keeps the message id", async () => {
    const { pi, claude } = await stageBoth();

    // pi-peer's await defaults to true, so a report that omits it blocks until the
    // planner answers — ralph's own rule says messaging never gates dispatch. The
    // message id is what makes the send readable afterwards without a second send.
    const piTransport = section(pi.ralphReference, "### Transport") + section(pi.ralphReference, "### The `pi-peer` package (PI)");
    assert.match(piTransport, /await: false/, "the pi transport turns the reply wait off for a report");
    assert.match(piTransport, /\bmessageId\b/, "the pi transport keeps the returned messageId");

    // `await` is a pi-peer parameter. Claude Code's send has no such option, so a
    // render that carries it would instruct a call the harness cannot make.
    const claudeTransport = section(claude.ralphReference, "### Transport");
    assert.doesNotMatch(claudeTransport, /\bawait\b/, "the claude transport is handed no pi-peer parameter");
  });

  it("maps every ralph kind to a transport intent inside the transport subsection alone", async () => {
    const { pi, claude } = await stageBoth();

    /** @type {Array<[string, string]>} */
    const mapping = [
      ["handoff", "task"],
      ["update", "notify"],
      ["done", "notify"],
      ["blocked", "notify"],
      ["failed", "notify"],
      ["get", "ask"],
      ["ask", "ask"],
    ];

    /** The table row whose first cell is the kind, so a row that merely names an
     * intent is never mistaken for the kind's own row.
     * @param {string} doc @param {string} kind @returns {string | undefined} */
    const rowFor = (doc, kind) =>
      section(doc, "### Transport")
        .split("\n")
        .filter((line) => line.startsWith("|"))
        .find((line) => line.split("|")[1]?.trim() === `\`${kind}\``);

    for (const [harness, doc] of [["pi", pi.ralphReference], ["claude", claude.ralphReference]]) {
      for (const [kind, intent] of mapping) {
        const row = rowFor(doc, kind);
        assert.ok(row, `the ${harness} transport maps \`${kind}\``);
        assert.ok(row.includes(`\`${intent}\``), `the ${harness} transport sends \`${kind}\` as \`${intent}\``);
      }
      // The mapping is the one thing the fork carries, so the shared table must
      // state none of it — otherwise the two renders could disagree about an intent.
      assert.doesNotMatch(section(doc, "### Message kinds"), /intent/i, `the ${harness} shared kinds table states no intent`);
    }
  });

  it("quotes no peer-list output the installed package does not print", async () => {
    const { pi, claude } = await stageBoth();

    // pi-peer's peer_list prints one line per peer (`<id> · role:… · <status>`), and
    // its status footer prints `N online`, never `N online - <id>`. A quoted string
    // the package never emits sends the reader looking for output that cannot appear.
    for (const [harness, doc] of [["pi", pi.ralphSkill], ["claude", claude.ralphSkill]]) {
      assert.doesNotMatch(doc, /\b\d+ online\b/, `the ${harness} ralph skill quotes no online count`);
    }
    for (const [harness, doc] of [["pi", pi.ralphReference], ["claude", claude.ralphReference]]) {
      const start = doc.indexOf("## Peer messaging");
      assert.notEqual(start, -1, `the ${harness} reference carries the peer-messaging section`);
      assert.doesNotMatch(doc.slice(start), /\bonline\s+[-–]\s/, `the ${harness} reference quotes no online-peer line`);
    }
  });

  it("takes the peer's name from the session and the list instead of printing one", async () => {
    const { pi, claude } = await stageBoth();

    // A session's peers are configuration, so the shipped text cannot know what the
    // one reachable peer is called. Naming it makes the reader hunt for an id that
    // their config need not contain.
    for (const [harness, doc] of [["pi", pi.ralphSkill], ["claude", claude.ralphSkill]]) {
      const init = section(doc, "### 1. Initialize (run once at startup)");

      // "from the list": the id is read off what the peer list prints.
      assert.match(init, /that list reports/, `the ${harness} skill defers the peer id to the list`);

      // "from the session": the step publishes a placeholder the session fills in,
      // and no second, literal id beside it.
      assert.match(init, /PI_PEER_ID=<[^<>]+>/, `the ${harness} skill takes the peer id as a placeholder`);
      assert.doesNotMatch(init.replaceAll(/PI_PEER_ID=<[^<>]+>/g, ""), /PI_PEER_ID=/, `the ${harness} skill states no fixed peer id`);

      // "instead of printing one": the two actor names are roles here, so neither is
      // offered as something to type — backticked, as an @handle, or after "as".
      assert.doesNotMatch(init, /`(?:planner|ralph)`|@(?:planner|ralph)\b|\bas\s+`?(?:planner|ralph)`?\b/, `the ${harness} skill prints no peer name`);
    }
  });

  it("names the pi-only progress and context tools nowhere outside the runbook", async () => {
    const { pi, claude } = await stageBoth();

    // peer_progress and peer_context are pi-peer tools with no Claude Code
    // counterpart. Shared prose that named them would either leave a literal token
    // or a broken sentence once the token was dropped.
    for (const [harness, doc] of [["pi", pi.ralphReference], ["claude", claude.ralphReference]]) {
      const runbook = section(doc, "### The `pi-peer` package (PI)");
      assert.doesNotMatch(doc.replace(runbook, ""), /peer_progress|peer_context/, `the ${harness} reference keeps them in the runbook`);
    }
    for (const [harness, doc] of [["pi", pi.ralphSkill], ["claude", claude.ralphSkill]]) {
      assert.doesNotMatch(doc, /peer_progress|peer_context/, `the ${harness} ralph skill names neither`);
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
