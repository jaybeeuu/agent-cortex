// Unit tests for scripts/lib/fs.mjs — the shared async stat wrappers. The
// helpers are exercised through their public API only; each case creates its
// own throwaway fixture under os.tmpdir().

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDirectory, isFile } from "../scripts/lib/fs.mjs";

async function makeTmp() {
  return await mkdtemp(join(tmpdir(), "agent-cortex-fs-"));
}

describe("isFile", () => {
  it("is true for an existing regular file", async () => {
    const dir = await makeTmp();
    try {
      const file = join(dir, "file.txt");
      await writeFile(file, "hello");
      assert.equal(await isFile(file), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is false for a directory", async () => {
    const dir = await makeTmp();
    try {
      assert.equal(await isFile(dir), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is false for a missing path", async () => {
    const dir = await makeTmp();
    try {
      assert.equal(await isFile(join(dir, "nope.txt")), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("isDirectory", () => {
  it("is true for an existing directory", async () => {
    const dir = await makeTmp();
    try {
      assert.equal(await isDirectory(dir), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is false for a regular file", async () => {
    const dir = await makeTmp();
    try {
      const file = join(dir, "file.txt");
      await writeFile(file, "hello");
      assert.equal(await isDirectory(file), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is false for a missing path", async () => {
    const dir = await makeTmp();
    try {
      assert.equal(await isDirectory(join(dir, "nope")), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
