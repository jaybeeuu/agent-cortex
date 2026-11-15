// Every {{PATH:...}} row an install renders must name a file the install
// actually contains. An agent text row is read on a machine that has no copy of
// this checkout, so a row that renders to a bare relative path — or to the
// source tree's grouped skill layout on a harness that stages skills flat — is a
// dead end for the agent that follows it.
//
// Both installs are staged by the CLI into workspaces under a per-process temp
// root that a file-level after() hook removes. Only the staged trees are read:
// a check that passes because this checkout exists is not a check.
//
// The expected value of each row is derived from the authored token, then
// asserted twice: it must sit under the install's plugin root, and the staged
// text must contain it. The second assertion keeps the derivation honest — if an
// installer resolved a row differently, the value would not appear in the
// artefact and the test fails instead of checking a path nobody ships.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { loadTokenMap, substituteTokens } from "../scripts/lib/compose-agent.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI_PATH = join(ROOT, "bin", "agent-cortex.mjs");

/** @type {ReturnType<typeof createTempRoot>} */
const tempRoot = createTempRoot("agent-cortex-rendered-paths-");

/** Both harnesses render the same authored rows into their own layout.
 * @type {("pi" | "claude")[]} */
const HARNESSES = ["pi", "claude"];

const PATH_TOKEN_RE = /\{\{PATH:([^}]+)\}\}/g;
const LITERAL_TOKEN_RE = /\{\{(?:TOOL|PATH|SECTION):/;

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

/** Every file below `dir`, absolute.
 * @param {string} dir
 * @returns {Promise<string[]>} */
async function listFiles(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** True when `p` is a regular file.
 * @param {string} p
 * @returns {Promise<boolean>} */
async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** The authored sources an install renders: each agent's shared body plus its
 * per-harness section files, and every skill markdown file.
 * @param {string} harness
 * @returns {Promise<string[]>} */
async function authoredSources(harness) {
  /** @type {string[]} */
  const sources = [];
  const agentsDir = join(ROOT, "agents");
  for (const entry of await readdir(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const agentBody = join(agentsDir, entry.name, "agent.md");
    if (await isFile(agentBody)) sources.push(agentBody);
    const harnessDir = join(agentsDir, entry.name, harness);
    for (const section of await readdir(harnessDir).catch(() => [])) {
      const file = join(harnessDir, section);
      if (section.endsWith(".md") && (await isFile(file))) sources.push(file);
    }
  }
  for (const file of await listFiles(join(ROOT, "skills"))) {
    if (file.endsWith(".md")) sources.push(file);
  }
  return sources;
}

/** Every `{{PATH:...}}` argument authored in the sources an install renders.
 * @param {string} harness
 * @returns {Promise<{ arg: string, source: string }[]>} */
async function authoredPathRows(harness) {
  /** @type {{ arg: string, source: string }[]} */
  const rows = [];
  for (const source of await authoredSources(harness)) {
    const content = await readFile(source, "utf-8");
    for (const match of content.matchAll(PATH_TOKEN_RE)) {
      rows.push({ arg: match[1], source: relative(ROOT, source) });
    }
  }
  return rows;
}

/** Neither install may ship a literal token in the text an agent reads.
 * @param {string} file
 * @returns {Promise<string[]>} */
async function literalTokenOffenders(file) {
  const content = await readFile(file, "utf-8");
  return LITERAL_TOKEN_RE.test(content) ? [file] : [];
}

/** Stage one install through the CLI and return its output dir.
 * @param {"pi" | "claude"} harness
 * @returns {Promise<string>} */
async function stageInstall(harness) {
  const out = await tempRoot.createWorkspace();
  const result = await runCli(["install", harness, "--output", out]);
  assert.equal(result.exitCode, 0, `install ${harness} --output failed: ${result.stdout}${result.stderr}`);
  return out;
}

describe("rendered path rows", () => {
  for (const harness of HARNESSES) {
    it(`${harness}: every {{PATH:...}} row resolves to a file in the staged install`, async () => {
      const out = await stageInstall(harness);
      const tokenMap = await loadTokenMap(ROOT);
      const pluginRoot = /** @type {string} */ (tokenMap.paths.plugin_root[harness]);
      const rows = await authoredPathRows(harness);
      assert.ok(rows.length > 0, `expected the ${harness} sources to author at least one {{PATH:...}} row`);

      // The staged text, so a row the installer resolved differently cannot pass
      // by being checked against a value no installed file carries.
      const stagedText = (
        await Promise.all(
          (await listFiles(out)).filter((file) => file.endsWith(".md")).map((file) => readFile(file, "utf-8")),
        )
      ).join("\n");

      /** @type {string[]} */
      const problems = [];
      for (const { arg, source } of rows) {
        const value = substituteTokens(`{{PATH:${arg}}}`, harness, tokenMap, {
          dropNullTools: true,
          pluginRoot,
          resolveRelativePaths: true,
        });
        const inside = value.slice(pluginRoot.length + 1);
        if (!value.startsWith(`${pluginRoot}/`)) {
          problems.push(`${source}: {{PATH:${arg}}} rendered "${value}" — not under the install's plugin root "${pluginRoot}"`);
          continue;
        }
        if (!(await isFile(join(out, inside)))) {
          problems.push(`${source}: {{PATH:${arg}}} rendered "${value}" — no such file in the staged install`);
          continue;
        }
        if (!stagedText.includes(value)) {
          problems.push(`${source}: {{PATH:${arg}}} rendered "${value}" — the staged text never names it, so the installer resolved it differently`);
        }
      }

      assert.deepEqual(problems, [], `rows that do not resolve in the ${harness} install:\n${problems.join("\n")}`);
    });

    it(`${harness}: no rendered agent or skill prints a literal substitution token`, async () => {
      const out = await stageInstall(harness);
      const rendered = (await listFiles(out)).filter(
        (file) => file.endsWith(".md") && /^(agents|skills)\//.test(relative(out, file)),
      );
      assert.ok(rendered.length > 0, `expected the ${harness} install to render agents or skills`);

      /** @type {string[]} */
      const offenders = [];
      for (const file of rendered) offenders.push(...(await literalTokenOffenders(file)));
      assert.deepEqual(
        offenders.map((file) => relative(out, file)),
        [],
        `a literal token reached the ${harness} install unsubstituted`,
      );
    });
  }
});
