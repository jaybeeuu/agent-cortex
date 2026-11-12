// Guards the documentation a staged install ships. Skills are installed onto
// machines that have no copy of this checkout, so a skill that names an
// install-relative document is only correct when the install actually contains
// it. Both installs are staged from the real package root here, so the text an
// agent reads after install is the text under test.
//
// A "repo-owned doc reference" is a `docs/...` file that exists in this
// repository: skills that mention `docs/adr/`, `docs/ideas/` and the like mean
// the *user's* project, which no install can ship, so those are not checked.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { installPi } from "../bin/installers/pi.mjs";
import { installClaude } from "../bin/installers/claude.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** The canonical skill anatomy, referenced by write-a-skill and refactor-skill. */
const ANATOMY = "docs/skills/skill-anatomy.md";

/** Both installers materialise skills, so both must ship the doc.
 * @type {("pi" | "claude")[]} */
const HARNESSES = ["pi", "claude"];

const tempRoot = createTempRoot("agent-cortex-installed-docs-");

/** True when a path exists (file or directory).
 * @param {string} p
 * @returns {Promise<boolean>} */
async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
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
 * pi's bundled runtime packages are stubbed: they carry no docs and resolving
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

/** `docs/...` file paths named in `content` that this repository owns — the
 * documents an install must therefore contain.
 * @param {string} content
 * @returns {Promise<string[]>} */
async function repoDocReferences(content) {
  /** @type {Set<string>} */
  const refs = new Set();
  for (const match of content.matchAll(/\bdocs\/[A-Za-z0-9._/-]+/g)) {
    const path = match[0].replace(/\/+$/, "");
    if (await isFile(join(ROOT, path))) refs.add(path);
  }
  return [...refs];
}

/** The rendered `SKILL.md` whose frontmatter declares `name`.
 * @param {string[]} files
 * @param {string} name
 * @returns {Promise<{ file: string, content: string }>} */
async function findSkill(files, name) {
  for (const file of files) {
    if (!file.endsWith("SKILL.md")) continue;
    const content = await readFile(file, "utf-8");
    if (content.includes(`\nname: ${name}\n`)) return { file, content };
  }
  assert.fail(`no rendered skill named "${name}"`);
}

describe("installed docs", () => {
  for (const harness of HARNESSES) {
    it(`${harness}: ships the skill anatomy exactly once, byte-identical to the repo`, async () => {
      const out = await stageInstall(harness);
      const shipped = (await listFiles(out)).filter((file) => file.includes("skill-anatomy"));

      assert.equal(shipped.length, 1, `expected one shipped anatomy doc in the ${harness} install, found ${shipped.length}`);
      assert.equal(relative(out, shipped[0]), ANATOMY);
      assert.equal(await readFile(shipped[0], "utf-8"), await readFile(join(ROOT, ANATOMY), "utf-8"));
    });

    it(`${harness}: every repo-owned doc reference in a rendered skill resolves inside the install`, async () => {
      const out = await stageInstall(harness);
      const skills = (await listFiles(join(out, "skills"))).filter((file) => file.endsWith(".md"));

      /** @type {string[]} */
      const missing = [];
      for (const file of skills) {
        for (const ref of await repoDocReferences(await readFile(file, "utf-8"))) {
          if (!(await pathExists(join(out, ref)))) missing.push(`${relative(out, file)} → ${ref}`);
        }
      }

      assert.deepEqual(missing, [], `rendered skills reference paths the ${harness} install does not contain`);
    });

    it(`${harness}: renders the anatomy reference into write-a-skill and refactor-skill`, async () => {
      const out = await stageInstall(harness);
      const files = (await listFiles(join(out, "skills"))).filter((file) => file.endsWith(".md"));

      for (const name of ["write-a-skill", "refactor-skill"]) {
        const { file, content } = await findSkill(files, name);
        assert.ok(content.includes(ANATOMY), `${relative(out, file)} names the installed anatomy doc`);
        assert.ok(!content.includes("{{PATH:"), `${relative(out, file)} carries no unresolved path token`);
      }
    });
  }
});
