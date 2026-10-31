// Guard: the staged pi package must load the agent-cortex extensions on its own.
//
// `agent-cortex install pi` copies `extensions/` into the staged package as
// files, with no node_modules of its own, and pi's loader resolves a bare import
// from the extension file's directory. An extension that value-imports
// `@earendil-works/*` therefore loaded only under a pi whose loader aliases
// those names — pi 0.73.1 aliases the pre-rename `@mariozechner/*` names and
// `typebox`, not `@earendil-works/*` — so auto-name, notify, subagent and
// agent-modes failed to load for every project outside this checkout, where
// pnpm had installed each extension's own copy of pi's packages.
//
// The suite stayed green because every case exercised the sources, never the
// staged tree. This case stages the real package, then loads its extensions from
// a temp directory outside the repo with pi absent, so a re-introduced
// `@earendil-works/*` value import turns the suite red.
//
// The load case alone is not enough: tsx/esbuild elides a value import that
// nothing references, so an unused import never reaches the loader. The static
// scan below reads every extension source and rejects a value import of pi's
// runtime whether or not it is referenced — the acceptance rule is about the
// source, not about what the bundler happens to emit.
//
// `typebox` is supplied to the loader: pi documents it as a host-provided module
// for extensions (pi's docs/packages.md) and aliases it in every loader, so it is
// the one bare import an extension may make. Nothing else is supplied — an import
// of pi itself must fail.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installPi } from "../bin/installers/pi.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/**
 * The package prefix no extension may value-import. `typebox` is not under it:
 * pi supplies that module to extensions, so it is allowed.
 */
const PI_RUNTIME = "@earendil-works/";

/**
 * Write the loader that imports each extension entrypoint and reports which ones
 * throw, plus the resolve hook that supplies `typebox` the way pi does.
 * @returns {Promise<string>} Path of the loader module
 */
async function writeLoader() {
  const dir = await mkdtemp(join(tmpdir(), "pi-load-"));
  const typeboxEntry = pathToFileURL(require.resolve("typebox")).href;

  await writeFile(
    join(dir, "host-modules.mjs"),
    `const TYPEBOX = ${JSON.stringify(typeboxEntry)};

export async function resolve(specifier, context, next) {
  if (specifier === "typebox") return { url: TYPEBOX, shortCircuit: true };
  return next(specifier, context);
}
`,
  );

  const loaderPath = join(dir, "load-extensions.mjs");
  await writeFile(
    loaderPath,
    `import { register } from "node:module";

register("./host-modules.mjs", import.meta.url);

const entries = process.argv.slice(2);
const failures = [];
for (const entry of entries) {
  try {
    await import(entry);
  } catch (error) {
    failures.push({ entry, message: error instanceof Error ? error.message : String(error) });
  }
}
process.stdout.write(JSON.stringify({ entries: entries.length, failures }));
`,
  );

  return loaderPath;
}

/**
 * Load every entrypoint from a temp directory outside the repo.
 * @param {string[]} entries Absolute entrypoint paths
 * @returns {Promise<{ entries: number, failures: { entry: string, message: string }[] }>}
 */
async function loadEntries(entries) {
  const loaderPath = await writeLoader();
  const tsxEsm = pathToFileURL(require.resolve("tsx/esm")).href;
  const cwd = await mkdtemp(join(tmpdir(), "pi-load-cwd-"));

  const run = spawn(process.execPath, ["--import", tsxEsm, loaderPath, ...entries], {
    cwd,
    env: { ...process.env, NODE_PATH: "" },
  });

  /** @type {Buffer[]} */
  const stdout = [];
  /** @type {Buffer[]} */
  const stderr = [];
  run.stdout.on("data", (chunk) => stdout.push(chunk));
  run.stderr.on("data", (chunk) => stderr.push(chunk));

  const exitCode = await new Promise((resolve) => run.on("close", resolve));
  const output = Buffer.concat(stdout).toString("utf-8");
  const errors = Buffer.concat(stderr).toString("utf-8");

  await rm(dirname(loaderPath), { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });

  assert.equal(exitCode, 0, `the loader itself failed:\n${errors}`);
  assert.equal(errors, "", "loading an extension must not write to stderr");
  return JSON.parse(output);
}

/**
 * Every extension source file under `dir`, recursively, skipping node_modules.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function sourceFiles(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") files.push(...(await sourceFiles(path)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Static import/export statements and their module specifiers. The clause may
 * span lines (a multi-line named import) but never a semicolon, so each match is
 * one statement.
 */
const STATIC_FROM = /^[ \t]*(?:import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']/gm;

/** Side-effect imports (`import "x"`), dynamic imports and requires: always value. */
const BARE_LOADS = [/^[ \t]*import\s*["']([^"']+)["']/gm, /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g];

/**
 * Whether an import clause binds no runtime value: `import type …`, or a named
 * list whose every specifier is inline `type` (both are erased).
 * @param {string} clause
 * @returns {boolean}
 */
function isTypeOnly(clause) {
  const trimmed = clause.trim();
  if (/^type\s/.test(trimmed)) return true;
  const named = /^\{([\s\S]*)\}$/.exec(trimmed);
  if (named === null) return false;
  const specifiers = named[1]
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean);
  return (
    specifiers.length > 0 &&
    specifiers.every((specifier) => /^type\s+[\w$]+(?:\s+as\s+[\w$]+)?$/.test(specifier))
  );
}

/**
 * Every value import of pi's runtime in the extension sources, as
 * `file:line specifier`. `extensions/` is the shipped surface: the staged package
 * copies it verbatim, so a violation here is a violation after install.
 * @returns {Promise<string[]>}
 */
async function runtimeImports() {
  /** @type {string[]} */
  const violations = [];
  for (const file of await sourceFiles(join(REPO_ROOT, "extensions"))) {
    const content = await readFile(file, "utf-8");
    /** @param {number} index @returns {number} */
    const lineOf = (index) => content.slice(0, index).split("\n").length;

    for (const match of content.matchAll(STATIC_FROM)) {
      const [, clause, specifier] = match;
      if (!specifier.startsWith(PI_RUNTIME)) continue;
      if (isTypeOnly(clause)) continue;
      violations.push(`${file}:${lineOf(match.index)} ${specifier}`);
    }

    for (const pattern of BARE_LOADS) {
      for (const match of content.matchAll(pattern)) {
        if (!match[1].startsWith(PI_RUNTIME)) continue;
        violations.push(`${file}:${lineOf(match.index)} ${match[1]}`);
      }
    }
  }
  return violations;
}

/**
 * The entrypoints a directory contributes, per pi's discovery rules: direct
 * `*.ts`/`*.js` files, and each subdirectory's manifest-declared extensions or
 * its `index.ts`/`index.js`. One level deep, no recursion.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function discoverInDir(dir) {
  /** @type {string[]} */
  const entries = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
      entries.push(path);
      continue;
    }
    if (!entry.isDirectory()) continue;

    const declared = await readPiExtensions(join(path, "package.json"));
    if (declared.length > 0) {
      for (const rel of declared) entries.push(join(path, rel));
    } else if (await exists(join(path, "index.ts"))) {
      entries.push(join(path, "index.ts"));
    } else if (await exists(join(path, "index.js"))) {
      entries.push(join(path, "index.js"));
    }
  }
  return entries;
}

/**
 * The `pi.extensions` paths a package.json declares, or none.
 * @param {string} manifestPath
 * @returns {Promise<string[]>}
 */
async function readPiExtensions(manifestPath) {
  if (!(await exists(manifestPath))) return [];
  /** @type {any} */
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const declared = manifest?.pi?.extensions;
  return Array.isArray(declared) ? declared : [];
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function exists(path) {
  try {
    await readdir(path);
    return true;
  } catch {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }
}

describe("extension sources — runtime coupling", () => {
  it("value-imports nothing from pi's runtime", async () => {
    const violations = await runtimeImports();

    assert.deepEqual(
      violations,
      [],
      "an extension must not value-import @earendil-works/*; pi supplies only typebox",
    );
  });
});

describe("staged pi package — extension loading", () => {
  it("loads every agent-cortex extension with pi absent", async () => {
    const output = join(await mkdtemp(join(tmpdir(), "pi-staged-load-")), "package");
    try {
      await installPi({ root: REPO_ROOT, output });
      const entries = await discoverInDir(join(output, "extensions"));

      assert.ok(entries.length >= 8, `expected every staged extension, got ${entries.join(", ")}`);
      const { failures } = await loadEntries(entries);
      assert.deepEqual(failures, [], "every staged extension must load on its own");
    } finally {
      await rm(dirname(output), { recursive: true, force: true });
    }
  });

  it("fails the guard when an extension imports pi's runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-staged-broken-"));
    try {
      const entry = join(dir, "extensions", "broken", "index.ts");
      await mkdir(dirname(entry), { recursive: true });
      await writeFile(
        entry,
        'import { getAgentDir } from "@earendil-works/pi-coding-agent";\nexport default () => getAgentDir();\n',
      );

      const { failures } = await loadEntries([entry]);

      assert.equal(failures.length, 1, "a runtime import pi does not supply must be reported");
      assert.match(failures[0].message, /@earendil-works\/pi-coding-agent/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
