// Every `<...scripts>` placeholder a shipped skill prints must be defined in the
// same file, or defined in a file that ships in the same install. A placeholder
// that no shipped file defines is worse than an undefined variable: a reader
// substitutes it literally, so `node <x-scripts>/strategy.mjs validate` exits
// ENOENT and a step's guard is skipped with no verdict at all.
//
// The convention this guards is the one `create-task` and `classify-bead` write
// down next to the command they qualify:
//
//     `<skill-scripts>` is the absolute path to this skill's own `scripts/`
//     directory, resolved from wherever this skill was loaded.
//
// A skill that calls a sibling's scripts reuses the sibling's definition rather
// than restating it, so a definition anywhere in the install counts. What never
// counts is a name defined nowhere — that is the defect this file was added for:
// `<strategise-scripts>` was used in four places and defined in none.
//
// Both installs are staged by the CLI and only the staged trees are read: the
// text under test is the text a consumer receives, on a machine with no copy of
// this checkout.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { installPi } from "../bin/installers/pi.mjs";
import { installClaude } from "../bin/installers/claude.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** Both installers materialise skills, so both get the check.
 * @type {("pi" | "claude")[]} */
const HARNESSES = ["pi", "claude"];

/** A placeholder use. The prefix is required, so prose such as
 * ``pnpm --prefix <scripts>`` is not mistaken for one.
 * @type {RegExp} */
const USE_RE = /<([a-z0-9-]+scripts)>/g;

/** A definition, in the one sentence pattern the shipped skills already use.
 * @param {string} name
 * @returns {RegExp} */
function definitionRe(name) {
  return new RegExp("`<" + name + ">`\\s+is\\b");
}

const tempRoot = createTempRoot("agent-cortex-skill-placeholder-");

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

/** Stage one install of the real package root and return its output dir.
 * pi's bundled runtime packages are stubbed: they carry no skills, and resolving
 * the real trees copies megabytes the check does not read.
 * @param {"pi" | "claude"} harness
 * @returns {Promise<string>} */
async function stageInstall(harness) {
  const out = await tempRoot.createWorkspace();
  if (harness === "pi") {
    const stub = await tempRoot.createWorkspace();
    await writeFile(join(stub, "package.json"), JSON.stringify({ name: "stub", version: "0.0.0" }));
    await installPi({ root: ROOT, output: out, resolvePackage: async () => stub, warn: () => {} });
  } else {
    await installClaude({ root: ROOT, output: out, warn: () => {} });
  }
  return out;
}

/** Every placeholder used in `content`, deduplicated, in order of appearance.
 * @param {string} content
 * @returns {string[]} */
function placeholdersUsed(content) {
  /** @type {string[]} */
  const names = [];
  for (const match of content.matchAll(USE_RE)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

describe("shipped skill placeholders", () => {
  for (const harness of HARNESSES) {
    it(`${harness}: defines every <…scripts> placeholder a shipped skill uses`, async () => {
      const out = await stageInstall(harness);
      const files = await listFiles(join(out, "skills"));

      /** @type {Map<string, string>} */
      const contents = new Map();
      for (const file of files) {
        contents.set(file, await readFile(file, "utf-8"));
      }

      /** Names defined somewhere in this install. @type {Set<string>} */
      const defined = new Set();
      for (const content of contents.values()) {
        for (const name of placeholdersUsed(content)) {
          if (definitionRe(name).test(content)) defined.add(name);
        }
      }

      /** @type {string[]} */
      const offenders = [];
      for (const [file, content] of contents) {
        for (const name of placeholdersUsed(content)) {
          if (defined.has(name)) continue;
          if (definitionRe(name).test(content)) continue;
          offenders.push(`${relative(out, file)} → <${name}>`);
        }
      }

      assert.deepEqual(
        offenders,
        [],
        `a placeholder no shipped file defines resolves to a directory that exists nowhere, so its command exits ENOENT and the step it guards is skipped: ${offenders.join(", ")}`,
      );
    });
  }

  it("pi: the definition of every <…scripts> placeholder is in the same file as the use it qualifies, or in another shipped skill", async () => {
    const out = await stageInstall("pi");
    const files = (await listFiles(join(out, "skills")));

    /** @type {Map<string, string>} */
    const contents = new Map();
    for (const file of files) contents.set(file, await readFile(file, "utf-8"));

    /** Every definition sentence in the install, by placeholder name. @type {Map<string, string[]>} */
    const definers = new Map();
    for (const [file, content] of contents) {
      for (const name of placeholdersUsed(content)) {
        if (!definitionRe(name).test(content)) continue;
        definers.set(name, [...(definers.get(name) ?? []), relative(out, file)]);
      }
    }

    // The template is copied into a consumer's repository, where no skill sits
    // beside the reader, so its placeholder cannot lean on its own location: it
    // must be defined in that file itself.
    const template = files.find((file) => file.endsWith(join("strategise", "templates", "strategy.md")));
    assert.ok(template, "the pi install ships the strategy template");
    const templateText = await readFile(template, "utf-8");
    for (const name of placeholdersUsed(templateText)) {
      assert.ok(
        definitionRe(name).test(templateText),
        `the strategy template is copied outside the skill tree, so <${name}> must be defined in the template itself, not only in ${definers.get(name)?.join(", ") ?? "anywhere"}`,
      );
    }
  });
});
