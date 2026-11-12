// Fixtures for the fingerprints `ctx version` reads: each installed harness
// records its version in a manifest under the home install root. The paths are
// spelled out here (not imported from lib/) so a test fails when the command
// reads somewhere other than where the installers write.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** @type {Record<"pi" | "claude", string[]>} */
export const FINGERPRINT_PATHS = {
  pi: [".agent-cortex", "pi", "package.json"],
  claude: [".agent-cortex", "claude", ".claude-plugin", "plugin.json"],
};

/**
 * Write a harness fingerprint under a fake home directory.
 * @param {string} home Fake home directory
 * @param {"pi" | "claude"} harness Harness whose fingerprint to write
 * @param {string} content Raw file content (valid JSON, or not, as the case needs)
 * @returns {Promise<void>}
 */
export async function writeFingerprint(home, harness, content) {
  const segments = FINGERPRINT_PATHS[harness];
  const dir = join(home, ...segments.slice(0, -1));
  await mkdir(dir, { recursive: true });
  await writeFile(join(home, ...segments), content);
}
