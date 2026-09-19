// Shared async filesystem predicates. The install-time generators all need the
// same "does this path exist and is it a file/directory?" probe, and the repo
// convention is async-only (no *Sync) in tooling code — see scripts/check-no-sync.mjs.
//
// Both probes are stat-based and resolve `false` on any error (missing path,
// permission denied, broken symlink), so callers can branch on existence
// without a separate try/catch:
//
//   if (await isFile(join(dir, "agent.md"))) { … }
//
// Zero dependencies so it runs on the CI Node (20) and local Node alike.

import { stat } from "node:fs/promises";

/** True when `p` exists and is a regular file; false on any error. */
export async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** True when `p` exists and is a directory; false on any error. */
export async function isDirectory(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
