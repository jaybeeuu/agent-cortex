// Tests for the stateful fake `bd` helper's `--validate` model.
// The fake mirrors `bd create --validate`: a substantive bead whose description lacks the
// required section(s) for its type is rejected; chores have no requirements.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeFakeBd } from "./helpers/fake-bd.mjs";

/** Run the fake `bd` binary with the given args. */
function runFake(bin, state, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { env: { ...process.env, FAKE_BD_STATE: state } }, (error, stdout, stderr) => {
      resolve({ exitCode: error ? error.code ?? 1 : 0, stdout, stderr });
    });
  });
}

/** Create a fresh fake workspace, run `fn`, then remove it. */
async function withFake(fn) {
  const dir = await mkdtemp(join(tmpdir(), "fake-bd-"));
  try {
    const { bin, state } = await makeFakeBd(dir, { beads: [] });
    await fn(bin, state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("fake bd --validate", () => {
  it("rejects a section-less task", async () => {
    await withFake(async (bin, state) => {
      const { exitCode, stderr } = await runFake(bin, state, ["create", "empty", "--type", "task", "--validate"]);
      assert.equal(exitCode, 1);
      assert.match(stderr, /Acceptance Criteria/);
    });
  });

  it("accepts a task carrying ## Acceptance Criteria (case-insensitive)", async () => {
    await withFake(async (bin, state) => {
      const { exitCode } = await runFake(bin, state, [
        "create", "ok", "--type", "task",
        "--description", "## Acceptance criteria\n- [ ] done",
        "--validate",
      ]);
      assert.equal(exitCode, 0);
    });
  });

  it("requires ## Success Criteria for an epic", async () => {
    await withFake(async (bin, state) => {
      const { exitCode, stderr } = await runFake(bin, state, [
        "create", "ep", "--type", "epic",
        "--description", "## Acceptance Criteria\n- [ ] x",
        "--validate",
      ]);
      assert.equal(exitCode, 1);
      assert.match(stderr, /Success Criteria/);
    });
  });

  it("does not require sections for a chore", async () => {
    await withFake(async (bin, state) => {
      const { exitCode } = await runFake(bin, state, ["create", "c", "--type", "chore", "--validate"]);
      assert.equal(exitCode, 0);
    });
  });
});
