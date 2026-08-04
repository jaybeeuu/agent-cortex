import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadContextFile,
  loadSessionContext,
} from "../context-loader.ts";

// ─── loadContextFile ─────────────────────────────────────────────────────────

describe("loadContextFile", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "context-loader-test-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns file content when path exists", () => {
    const file = join(tmpDir, "AGENTS.md");
    writeFileSync(file, "# AGENTS\n\nProject instructions.", "utf-8");

    const result = loadContextFile(file);
    assert.ok(result);
    assert.equal(result.path, file);
    assert.equal(result.content, "# AGENTS\n\nProject instructions.");
  });

  it("returns null for non-existent file", () => {
    const result = loadContextFile(join(tmpDir, "nope.md"));
    assert.equal(result, null);
  });

  it("returns null for empty path", () => {
    const result = loadContextFile("");
    assert.equal(result, null);
  });

  it("strips leading and trailing whitespace from content", () => {
    const file = join(tmpDir, "padded.md");
    writeFileSync(file, "\n\n  # Title\n\nBody\n\n", "utf-8");

    const result = loadContextFile(file);
    assert.ok(result);
    assert.equal(result.content, "# Title\n\nBody");
  });
});

// ─── loadSessionContext ──────────────────────────────────────────────────────

describe("loadSessionContext", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "session-context-test-"));
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads all existing files from default list", () => {
    writeFileSync(join(tmpDir, "AGENTS.md"), "# Agents", "utf-8");
    writeFileSync(join(tmpDir, "docs", "user-preferences.md"), "# Prefs", "utf-8");

    const result = loadSessionContext(tmpDir);
    assert.ok(result.includes("# Agents"));
    assert.ok(result.includes("# Prefs"));
  });

  it("skips missing files silently", () => {
    const result = loadSessionContext(tmpDir);
    // Should not throw — missing files are just omitted
    assert.equal(typeof result, "string");
  });

  it("accepts custom file list", () => {
    const custom = join(tmpDir, "custom.md");
    writeFileSync(custom, "# Custom", "utf-8");

    const result = loadSessionContext(tmpDir, [custom]);
    assert.ok(result.includes("# Custom"));
  });

  it("returns empty string when no files exist", () => {
    const result = loadSessionContext("/nonexistent/path");
    assert.equal(typeof result, "string");
    assert.equal(result.length, 0);
  });

  it("formats files with headers", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "Hello world", "utf-8");

    const result = loadSessionContext(tmpDir, [file]);
    assert.ok(result.includes("---"));
    assert.ok(result.includes("test.md"));
    assert.ok(result.includes("Hello world"));
  });
});
