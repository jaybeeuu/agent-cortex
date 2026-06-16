import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  type UsageStore,
  type SkillRecord,
  recordUsage,
  resolveSkillFromPath,
  formatTable,
  extractSkillName,
  loadStore,
  saveStore,
  ageOutStore,
} from "./index.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function freshStore(): UsageStore {
  return {
    version: 1,
    skills: {},
    totalTurns: 0,
    lastUpdated: "2026-06-07T00:00:00.000Z",
    recentEvents: [],
  };
}

// ─── recordUsage ─────────────────────────────────────────────────────────────

describe("recordUsage", () => {
  it("records a 'loaded' event for a new skill", () => {
    const store = freshStore();
    recordUsage(store, "bd-tool", "loaded", "/proj/a");

    assert.equal(store.skills["bd-tool"].loadedCount, 1);
    assert.equal(store.skills["bd-tool"].invokedCount, 0);
    assert.equal(store.skills["bd-tool"].readCount, 0);
    assert.ok(store.skills["bd-tool"].lastUsed);

    // Project breakdown
    const proj = store.skills["bd-tool"].byProject["/proj/a"];
    assert.ok(proj);
    assert.equal(proj.loadedCount, 1);
  });

  it("increments counts for the same skill and same project", () => {
    const store = freshStore();
    recordUsage(store, "bd-tool", "loaded", "/proj/a");
    recordUsage(store, "bd-tool", "loaded", "/proj/a");
    recordUsage(store, "bd-tool", "invoked", "/proj/a");

    const s = store.skills["bd-tool"];
    assert.equal(s.loadedCount, 2);
    assert.equal(s.invokedCount, 1);
    assert.equal(s.readCount, 0);

    const p = s.byProject["/proj/a"];
    assert.equal(p.loadedCount, 2);
    assert.equal(p.invokedCount, 1);
    assert.equal(p.readCount, 0);
  });

  it("tracks separate counts per project", () => {
    const store = freshStore();
    recordUsage(store, "style-code", "read", "/proj/a");
    recordUsage(store, "style-code", "read", "/proj/b");

    const s = store.skills["style-code"];
    assert.equal(s.readCount, 2); // global total

    assert.equal(s.byProject["/proj/a"].readCount, 1);
    assert.equal(s.byProject["/proj/b"].readCount, 1);
  });

  it("appends a recent event entry each time", () => {
    const store = freshStore();
    recordUsage(store, "bd-tool", "loaded", "/proj/a");
    recordUsage(store, "bd-tool", "invoked", "/proj/a");

    assert.equal(store.recentEvents.length, 2);
    assert.equal(store.recentEvents[0].source, "loaded");
    assert.equal(store.recentEvents[1].source, "invoked");
  });

  it("updates lastUsed on every call", async () => {
    const store = freshStore();
    recordUsage(store, "bd-tool", "loaded", "/proj/a");

    const first = store.skills["bd-tool"].lastUsed;

    // Small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 5));
    recordUsage(store, "bd-tool", "read", "/proj/a");

    const second = store.skills["bd-tool"].lastUsed;
    assert.notEqual(first, second);
  });
});

// ─── resolveSkillFromPath ────────────────────────────────────────────────────

describe("resolveSkillFromPath", () => {
  const known = new Map<string, SkillRecord>([
    ["bd-tool", { name: "bd-tool", skillMdPath: "/home/user/.pi/agent/skills/bd-tool/SKILL.md" }],
  ]);

  it("matches an exact pre-discovered SKILL.md path", () => {
    const result = resolveSkillFromPath(
      "/home/user/.pi/agent/skills/bd-tool/SKILL.md",
      known,
    );
    assert.equal(result, "bd-tool");
  });

  it("resolves a project-local path via heuristic", () => {
    const result = resolveSkillFromPath(
      "/home/user/projects/agent-cortex/skills/workflow/run-pipeline-stage/SKILL.md",
      new Map(), // empty known -> heuristic only
    );
    assert.equal(result, "run-pipeline-stage");
  });

  it("resolves a .pi/skills path via heuristic", () => {
    const result = resolveSkillFromPath(
      "/home/user/projects/my-app/.pi/skills/my-helper/SKILL.md",
      new Map(),
    );
    assert.equal(result, "my-helper");
  });

  it("resolves a deeply nested skills/ path via heuristic", () => {
    const result = resolveSkillFromPath(
      "/home/user/projects/my-app/.agents/skills/deploy/SKILL.md",
      new Map(),
    );
    assert.equal(result, "deploy");
  });

  it("returns null for a non-skill path", () => {
    const result = resolveSkillFromPath(
      "/home/user/projects/agent-cortex/src/index.ts",
      known,
    );
    assert.equal(result, null);
  });

  it("returns null for a path that looks like a skill but isn't in a known dir", () => {
    const result = resolveSkillFromPath(
      "/home/user/random/SKILL.md",
      known,
    );
    assert.equal(result, null);
  });

  it("normalises Windows backslashes", () => {
    const result = resolveSkillFromPath(
      "C:\\Users\\me\\projects\\app\\skills\\my-skill\\SKILL.md",
      new Map(),
    );
    assert.equal(result, "my-skill");
  });
});

// ─── formatTable ─────────────────────────────────────────────────────────────

describe("formatTable", () => {
  it("renders a table with header and rows", () => {
    const header = ["Skill", "Count", "Status"];
    const rows = [
      ["bd-tool", "42", "active"],
      ["style-code", "7", "active"],
    ];

    const output = formatTable(header, rows);
    const lines = output.split("\n");

    // Header present
    assert.ok(lines[0].includes("Skill"));
    assert.ok(lines[0].includes("Count"));

    // Separator line
    assert.ok(lines[1].includes("─"));

    // Data rows
    assert.ok(lines[2].includes("bd-tool"));
    assert.ok(lines[2].includes("42"));
    assert.ok(lines[3].includes("style-code"));
    assert.ok(lines[3].includes("7"));
  });

  it("pads columns to align them", () => {
    const header = ["A", "BB", "CCC"];
    const rows = [["x", "yy", "zzz"]];

    const output = formatTable(header, rows);
    const line = output.split("\n")[2]; // data row

    // Each column should be at least as wide as its header
    const parts = line.split("│");
    assert.ok(parts[0]!.length >= " A".length);
    assert.ok(parts[1]!.length >= " BB".length);
  });

  it("handles a single row", () => {
    const header = ["Name"];
    const rows = [["test"]];

    const output = formatTable(header, rows);
    assert.ok(output.includes("test"));
  });

  it("handles empty rows gracefully", () => {
    const header = ["A", "B"];
    const rows: string[][] = [];

    const output = formatTable(header, rows);
    assert.ok(output.includes("A"));
    assert.ok(output.includes("─"));
  });
});

// ─── extractSkillName ────────────────────────────────────────────────────────

describe("extractSkillName", () => {
  it("extracts name from frontmatter", () => {
    const content = `---
name: my-skill
description: Does things
---

# My Skill
`;
    const tmp = join(tmpdir(), "skill-stats-test-extract-" + Date.now());
    writeFileSync(tmp, content, "utf-8");
    try {
      assert.equal(extractSkillName(tmp), "my-skill");
    } finally {
      rmSync(tmp);
    }
  });

  it("returns null for file with no frontmatter", () => {
    const content = `# My Skill\nNo YAML frontmatter here.\n`;
    const tmp = join(tmpdir(), "skill-stats-test-no-fm-" + Date.now());
    writeFileSync(tmp, content, "utf-8");
    try {
      assert.equal(extractSkillName(tmp), null);
    } finally {
      rmSync(tmp);
    }
  });

  it("returns null for a non-existent file", () => {
    assert.equal(extractSkillName("/nonexistent/path/SKILL.md"), null);
  });
});

// ─── loadStore / saveStore ────────────────────────────────────────────────────

describe("loadStore / saveStore", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "skill-stats-test-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadStore returns a fresh store when file doesn't exist", () => {
    const store = loadStore(join(tmpDir, "nonexistent.json"));
    assert.equal(store.version, 1);
    assert.deepEqual(store.skills, {});
    assert.equal(store.totalTurns, 0);
  });

  it("saveStore writes and loadStore reads back", () => {
    const file = join(tmpDir, "test-store.json");
    const original = freshStore();
    original.totalTurns = 42;
    original.skills["test-skill"] = {
      loadedCount: 5,
      invokedCount: 2,
      readCount: 3,
      lastUsed: "2026-06-07T12:00:00.000Z",
      byProject: {
        "/project/a": {
          loadedCount: 3,
          invokedCount: 1,
          readCount: 2,
          lastUsed: "2026-06-07T12:00:00.000Z",
        },
      },
    };

    saveStore(original, file);
    assert.ok(existsSync(file));

    const loaded = loadStore(file);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.totalTurns, 42);
    assert.ok(loaded.skills["test-skill"]);
    assert.equal(loaded.skills["test-skill"].loadedCount, 5);
    assert.equal(
      loaded.skills["test-skill"].byProject["/project/a"].invokedCount,
      1,
    );

    // Ensure .tmp file was cleaned up atomically
    assert.ok(!existsSync(file + ".tmp"));
  });

  it("saveStore updates lastUpdated timestamp", () => {
    const file = join(tmpDir, "test-timestamp.json");
    const store = freshStore();
    store.lastUpdated = "2020-01-01T00:00:00.000Z";

    saveStore(store, file);
    const loaded = loadStore(file);
    assert.notEqual(loaded.lastUpdated, "2020-01-01T00:00:00.000Z");
  });

  it("loadStore returns fresh store for corrupt data", () => {
    const file = join(tmpDir, "corrupt.json");
    writeFileSync(file, "this is not json{{{", "utf-8");

    const store = loadStore(file);
    assert.equal(store.version, 1);
    assert.deepEqual(store.skills, {});
  });

  it("loadStore returns fresh store for wrong version", () => {
    const file = join(tmpDir, "wrong-version.json");
    writeFileSync(
      file,
      JSON.stringify({ version: 999, skills: {}, totalTurns: 0, lastUpdated: "", recentEvents: [] }),
      "utf-8",
    );

    const store = loadStore(file);
    assert.equal(store.version, 1);
    assert.deepEqual(store.skills, {});
  });
});

// ─── ageOutStore ─────────────────────────────────────────────────────────────

describe("ageOutStore", () => {
  const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
  const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();   // 100 days ago (over 3mo)

  it("removes skills with lastUsed older than 3 months", () => {
    const store = freshStore();
    store.skills["active"] = {
      loadedCount: 5, invokedCount: 0, readCount: 0,
      lastUsed: recentDate, byProject: {},
    };
    store.skills["stale"] = {
      loadedCount: 10, invokedCount: 2, readCount: 1,
      lastUsed: oldDate, byProject: {},
    };

    ageOutStore(store);

    assert.ok(store.skills["active"], "active skill should be kept");
    assert.equal(store.skills["stale"], undefined, "stale skill should be removed");
  });

  it("removes skills with no lastUsed (null)", () => {
    const store = freshStore();
    store.skills["never-used"] = {
      loadedCount: 0, invokedCount: 0, readCount: 0,
      lastUsed: null, byProject: {},
    };

    ageOutStore(store);
    assert.equal(store.skills["never-used"], undefined);
  });

  it("removes recentEvents older than 3 months", () => {
    const store = freshStore();
    store.recentEvents = [
      { timestamp: recentDate, skill: "active", source: "loaded", project: "/p" },
      { timestamp: oldDate, skill: "stale", source: "invoked", project: "/p" },
    ];

    ageOutStore(store);

    assert.equal(store.recentEvents.length, 1);
    assert.equal(store.recentEvents[0].skill, "active");
  });

  it("leaves empty store unchanged", () => {
    const store = freshStore();
    ageOutStore(store);
    assert.deepEqual(store.skills, {});
    assert.deepEqual(store.recentEvents, []);
  });
});
