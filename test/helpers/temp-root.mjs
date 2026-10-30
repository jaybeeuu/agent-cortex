// One temp root per test file (process), shared by every workspace the file
// creates.
//
// Cleanup owned by an individual test is only as reliable as that test's control
// flow: a test that throws before reaching its own `rm()` leaks its whole
// workspace. Each one is a materialised plugin tree (skills, agents, hooks — a
// few hundred KB spread over hundreds of files), and a single installer run
// allocates 21 of them, so the leak is measured in MB per run: enough to exhaust
// a small tmpfs over repeated runs, which then fails more tests, which leak more.
// The root is therefore removed by a file-level `after()` hook registered when
// the root is created, so it is removed whether every test passed, failed, or
// threw.

import { after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A lazily created temp root plus a factory for the workspaces inside it. */
class TempRoot {
  /** @type {string} */
  #prefix;

  /** @type {Promise<string> | null} */
  #root = null;

  /** @param {string} prefix mkdtemp prefix for the root directory */
  constructor(prefix) {
    this.#prefix = prefix;
  }

  /**
   * Create a workspace: a distinct subdirectory of the shared root, so tests in
   * the same file cannot collide even if they run concurrently.
   * @returns {Promise<string>}
   */
  async createWorkspace() {
    this.#root ??= mkdtemp(join(tmpdir(), this.#prefix));
    return await mkdtemp(join(await this.#root, "workspace-"));
  }

  /**
   * Remove the whole root, workspaces and all. A no-op when nothing was created.
   * @returns {Promise<void>}
   */
  async remove() {
    if (this.#root === null) return;
    const root = await this.#root;
    await rm(root, { recursive: true, force: true });
    this.#root = null;
  }
}

/**
 * Create the file's temp root. Call this at module scope: the returned root
 * registers a file-level `after()` hook that removes it (and every workspace in
 * it) once the file's tests have run, however they ended.
 * @param {string} prefix mkdtemp prefix, so leftovers are attributable to a file
 * @returns {TempRoot}
 */
export function createTempRoot(prefix) {
  const tempRoot = new TempRoot(prefix);
  after(() => tempRoot.remove());
  return tempRoot;
}
