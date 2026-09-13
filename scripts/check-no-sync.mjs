// Repo convention: never block the main thread — no `*Sync` functions
// (fs/child_process/...) in tooling code. Runs via `pnpm lint` (CI) and
// locally. Scans the toolchain and test dirs: bin/, scripts/, lib/, hooks/,
// test/. Skill-owned scripts (skills/*/scripts) and extensions are separate
// follow-up surfaces tracked outside this check.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN_DIRS = ["bin", "scripts", "lib", "hooks", "test"];
const EXTENSIONS = new Set([".mjs", ".js", ".ts"]);
const SELF = "scripts/check-no-sync.mjs";

const SYNC_CALL = /\b\w*Sync\s*\(/;

/** Recursively collect files under dir, skipping this script and node_modules. */
async function collect(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collect(full)));
    else if (EXTENSIONS.has(e.name.slice(e.name.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

const offenders = [];
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  for (const file of await collect(abs)) {
    const rel = relative(ROOT, file);
    if (rel === SELF) continue;
    const src = await readFile(file, "utf-8");
    const hits = src.split("\n").map((line, i) => ({ line: i + 1, text: line })).filter((l) => SYNC_CALL.test(l.text));
    if (hits.length) offenders.push({ rel, hits });
  }
}

if (offenders.length) {
  console.error("✗ Never block the main thread — *Sync function calls found:");
  for (const { rel, hits } of offenders) {
    for (const { line, text } of hits) console.error(`  ${rel}:${line}: ${text.trim()}`);
  }
  process.exit(1);
}
console.log("✓ no *Sync calls in tooling code (bin/, scripts/, lib/, hooks/, test/)");