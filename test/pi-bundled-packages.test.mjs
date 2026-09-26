// The pi tools agent-cortex's agents depend on (ask_questions, fetch_content)
// come from third-party pi packages that agent-cortex bundles as real
// dependencies. This is the acceptance test for that contract: pack the actual
// package, register the extracted tarball in a scratch pi scope using the
// shipped settings template, and load it through pi's resource loader. A missing
// bundle, a manifest path that does not resolve, a dropped runtime dependency,
// or a settings filter that hides the bundled resources fails here rather than
// on a fresh machine.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Run a command to completion, rejecting with its stderr on a non-zero exit. */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || error.message}`));
      else resolve({ stdout, stderr });
    });
  });
}

/** Pack the package under test into `destination` and extract it there. */
async function packAndExtract(destination) {
  await run("pnpm", ["pack", "--pack-destination", destination], { cwd: ROOT });
  const [tarball] = (await readdir(destination)).filter((name) => name.endsWith(".tgz"));
  assert.ok(tarball, "pnpm pack wrote a tarball");
  await run("tar", ["xzf", join(destination, tarball), "-C", destination]);
  return join(destination, "package");
}

/**
 * Register only the packed package in a scratch pi scope, reusing the shipped
 * settings template's own entry so the real `packages` filter is exercised. The
 * template's optional npm packages are dropped — installing them would need the
 * network and is not what this test proves.
 */
async function writeScopeSettings({ packageRoot, agentDir }) {
  const template = JSON.parse(await readFile(join(packageRoot, "pi", "settings.json"), "utf-8"));
  const selfReference = template.packages.find((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    return !source.startsWith("npm:");
  });
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ packages: [{ ...selfReference, source: packageRoot }] }, null, 2),
  );
}

describe("bundled pi packages", () => {
  it("loads ask_questions and fetch_content from a packed agent-cortex", async () => {
    const work = await mkdtemp(join(tmpdir(), "pi-bundled-"));
    try {
      const packageRoot = await packAndExtract(work);
      const agentDir = join(work, "agent");
      const cwd = join(work, "cwd");
      await mkdir(cwd, { recursive: true });
      await writeScopeSettings({ packageRoot, agentDir });

      const resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
      await resourceLoader.reload();

      const loaded = resourceLoader.getExtensions();
      assert.deepEqual(loaded.errors, [], "every extension in the packed package loads");
      const tools = loaded.extensions.flatMap((extension) => [...extension.tools.keys()]);
      assert.ok(tools.includes("ask_questions"), "ask_questions provided by the bundled pi-questions");
      assert.ok(tools.includes("fetch_content"), "fetch_content provided by the bundled pi-web-access");

      const skills = resourceLoader.getSkills().skills.map((skill) => skill.name);
      assert.ok(skills.includes("librarian"), "the pi-web-access skill loads from the bundle");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
