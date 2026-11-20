// Every `<...scripts>` placeholder a shipped skill prints must be defined by a
// shipped file, and that definition must name a `scripts/` directory the install
// really contains. A placeholder that no shipped file defines is worse than an
// undefined variable: a reader substitutes it literally, so
// `node <x-scripts>/strategy.mjs validate` exits ENOENT and a step's guard is
// skipped with no verdict at all.
//
// Only the sentence the shipped skills actually write is a definition:
//
//     `<skill-scripts>` is the absolute path to this skill's own `scripts/`
//     directory, resolved from wherever this skill was loaded.
//
// A mention — "`<x-scripts>` is never hardcoded; resolve it at use time" — is not
// a definition, because it says nothing about where the directory is. Neither is
// a sentence naming a skill this install does not ship, or a directory that does
// not exist: either substitutes to ENOENT, which is the defect this file guards.
// Both a mention and a phantom directory were reproduced against the earlier
// predicate, so the guard now requires the whole claim, not just the opening
// words.
//
// A skill that calls a sibling's scripts reuses the sibling's definition rather
// than restating it, so a definition anywhere in the install counts. What never
// counts is a name defined nowhere — that is the defect this file was added for:
// `<strategise-scripts>` was used in four places and defined in none.
//
// Both installs are staged by the CLI and only the staged trees are read: the
// text under test is the text a consumer receives, on a machine with no copy of
// this checkout. The two installers arrange skills differently — pi keeps the
// grouping directory, claude flattens — so a skill is found by its `SKILL.md`,
// never by a path shape.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
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

/** A definition, in the one sentence pattern the shipped skills use. A sentence
 * that merely starts the same way — "`<x>` is never hardcoded" — does not match,
 * because it goes on to say nothing about where the directory is.
 * @param {string} name
 * @returns {RegExp} */
function definitionRe(name) {
  return new RegExp("`<" + name + ">`\\s+is the absolute path to\\b");
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

/** Every staged skill file's text, keyed by absolute path.
 * @param {string} installRoot
 * @returns {Promise<Map<string, string>>} */
async function readInstall(installRoot) {
  /** @type {Map<string, string>} */
  const contents = new Map();
  for (const file of await listFiles(join(installRoot, "skills"))) {
    contents.set(file, await readFile(file, "utf-8"));
  }
  return contents;
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

/** `true` when `path` is a directory.
 * @param {string} path
 * @returns {Promise<boolean>} */
async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** The skills a staged install ships, by skill name, from their `SKILL.md`.
 * pi keeps the grouping directory and claude flattens it, so the name is taken
 * from the directory holding the `SKILL.md`, never from a path shape.
 * @param {Map<string, string>} contents
 * @returns {Map<string, string>} */
function skillsShipped(contents) {
  /** @type {Map<string, string>} */
  const skills = new Map();
  for (const file of contents.keys()) {
    if (basename(file) === "SKILL.md") skills.set(basename(dirname(file)), dirname(file));
  }
  return skills;
}

/** The shipped skill that owns `file`: the longest skill directory above it.
 * @param {string} file
 * @param {Map<string, string>} skills
 * @returns {string | null} */
function owningSkill(file, skills) {
  /** @type {string | null} */
  let owner = null;
  for (const dir of skills.values()) {
    if (!file.startsWith(dir + sep)) continue;
    if (owner === null || dir.length > owner.length) owner = dir;
  }
  return owner;
}

/** The skill whose `scripts/` directory a definition sentence names, or null when
 * the sentence names none. Three forms cover every shipped definition: this
 * skill's own `scripts/`, another staged `<skill>`'s `scripts/`, and a
 * skill-relative `<path>/scripts/` path whose parent segment is the skill.
 * @param {{content: string, name: string, file: string, skills: Map<string, string>}} arg
 * @returns {string | null} */
function claimedSkill({ content, name, file, skills }) {
  const match = definitionRe(name).exec(content);
  if (match === null) return null;
  const claim = content.slice(match.index + match[0].length, match.index + match[0].length + 200);
  if (/^\s*this skill's own\s+`scripts\//.test(claim)) {
    const owner = owningSkill(file, skills);
    return owner === null ? null : basename(owner);
  }
  const sibling =
    /^\s*the\s+`([a-z0-9-]+)`\s+skill's\s+`scripts\//.exec(claim) ??
    /^\s*the\s+`scripts\/`\s+directory of the\s+`([a-z0-9-]+)`\s+skill/.exec(claim);
  if (sibling !== null) return sibling[1];
  const namedPath = /^\s*`([^`]*\/scripts\/)`/.exec(claim);
  if (namedPath === null) return null;
  const segments = namedPath[1].split("/").filter(Boolean);
  if (segments.length < 2) return null;
  return segments[segments.length - 2];
}

/** Inspect one file's definition of one placeholder. `defined` is false unless
 * the file carries the definition sentence. A definition is sound only when it
 * names the skill the placeholder names, that skill ships, and its `scripts/`
 * directory exists in the staged tree — otherwise it resolves to a directory
 * that exists nowhere, which is the defect.
 * @param {{content: string, name: string, file: string, skills: Map<string, string>}} arg
 * @returns {Promise<{defined: boolean, dir: string | null, problem: string | null}>} */
async function inspectDefinition({ content, name, file, skills }) {
  const none = { defined: false, dir: null, problem: null };
  if (!definitionRe(name).test(content)) return none;
  const claimed = claimedSkill({ content, name, file, skills });
  if (claimed === null) {
    return { defined: true, dir: null, problem: "the sentence names no directory" };
  }
  const expected = name.slice(0, -"-scripts".length);
  if (expected !== "skill" && claimed !== expected) {
    return { defined: true, dir: null, problem: `it defines the \`${claimed}\` skill's scripts, not \`${expected}\`` };
  }
  const skill = skills.get(claimed);
  if (skill === undefined) {
    return { defined: true, dir: null, problem: `no staged skill is named \`${claimed}\`` };
  }
  const dir = join(skill, "scripts");
  if (!(await isDirectory(dir))) {
    return { defined: true, dir, problem: "the directory it names does not ship" };
  }
  return { defined: true, dir, problem: null };
}

describe("shipped skill placeholders", () => {
  for (const harness of HARNESSES) {
    it(`${harness}: defines every <…scripts> placeholder a shipped skill uses, and every definition names a directory that ships`, async () => {
      const out = await stageInstall(harness);
      const contents = await readInstall(out);
      const skills = skillsShipped(contents);

      /** @type {string[]} */
      const phantomDefinitions = [];
      /** Names with at least one sound definition. @type {Set<string>} */
      const defined = new Set();
      for (const [file, content] of contents) {
        for (const name of placeholdersUsed(content)) {
          const found = await inspectDefinition({ content, name, file, skills });
          if (!found.defined) continue;
          if (found.problem !== null) {
            const claimed = found.dir === null ? "" : ` → ${relative(out, found.dir)}`;
            phantomDefinitions.push(`${relative(out, file)} → <${name}>${claimed} (${found.problem})`);
            continue;
          }
          defined.add(name);
        }
      }

      /** @type {string[]} */
      const undefinedUses = [];
      for (const [file, content] of contents) {
        for (const name of placeholdersUsed(content)) {
          if (defined.has(name)) continue;
          undefinedUses.push(`${relative(out, file)} → <${name}>`);
        }
      }

      assert.deepEqual(
        phantomDefinitions,
        [],
        `a definition must name a directory this install really ships, otherwise the command it qualifies exits ENOENT and the step it guards is skipped: ${phantomDefinitions.join(", ")}`,
      );
      assert.deepEqual(
        undefinedUses,
        [],
        `a placeholder no shipped file defines resolves to a directory that exists nowhere, so its command exits ENOENT and the step it guards is skipped: ${undefinedUses.join(", ")}`,
      );
    });
  }

  it("pi: the strategy template defines its own <…scripts> placeholder, because a consumer copy has no skill tree beside it", async () => {
    const out = await stageInstall("pi");
    const contents = await readInstall(out);

    const template = [...contents.keys()].find((file) => file.endsWith(join("strategise", "templates", "strategy.md")));
    assert.ok(template, "the pi install ships the strategy template");
    const templateText = contents.get(template) ?? "";

    // A consumer copies the template into their repository, where no skill sits
    // beside the reader, so its placeholder cannot lean on its own location: it
    // must be defined in that file itself.
    for (const name of placeholdersUsed(templateText)) {
      /** @type {string[]} */
      const definers = [];
      for (const [file, content] of contents) {
        if (file === template) continue;
        if (definitionRe(name).test(content)) definers.push(relative(out, file));
      }
      assert.ok(
        definitionRe(name).test(templateText),
        `the strategy template is copied outside the skill tree, so <${name}> must be defined in the template itself, not only in ${definers.join(", ") || "anywhere"}`,
      );
    }
  });
});
