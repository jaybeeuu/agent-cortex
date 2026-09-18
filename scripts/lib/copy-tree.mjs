// Shared directory copier for the harness installers (copilot, claude, pi):
// recursively copies a source tree, transforming .md file contents (token
// substitution) and copying every other file verbatim. The three installers
// must produce the same tree shape with only the transform differing, so the
// copier lives here rather than in three copies.

import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Recursively copy a tree; transform .md file contents, copy everything else verbatim.
 *
 * @param {string} src        Source directory
 * @param {string} dest       Destination directory
 * @param {(content: string) => string} transform  Applied to each .md file's contents
 * @param {boolean} dryRun    Count files without writing when true
 * @returns {Promise<{ md: number, files: number }>} markdown/file counts
 */
export async function copyTree(src, dest, transform, dryRun) {
  let md = 0;
  let files = 0;
  for (const entry of await readdir(src, { withFileTypes: true })) {
    // Never ship local build artifacts: pnpm workspace installs create
    // node_modules/ inside skills/*/scripts, which is gitignored but would
    // otherwise be copied into every materialised plugin tree.
    if (entry.isDirectory() && entry.name === "node_modules") continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      const stats = await copyTree(from, to, transform, dryRun);
      md += stats.md;
      files += stats.files;
    } else if (entry.isFile()) {
      files += 1;
      if (entry.name.endsWith(".md")) md += 1;
      if (dryRun) continue;
      await mkdir(dest, { recursive: true });
      if (entry.name.endsWith(".md")) await writeFile(to, transform(await readFile(from, "utf-8")));
      else await copyFile(from, to);
    }
  }
  return { md, files };
}
