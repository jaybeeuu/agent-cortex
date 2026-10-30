// A test file that fails *after* creating its workspace — the failure path that
// leaks when cleanup lives in the test body.
//
// Driven by test/temp-root.test.mjs, which runs it with `node --test` and asserts
// the run leaked nothing. Not collected by the suite: `pnpm test` globs
// test/*.test.mjs, and this file lives under test/helpers/fixtures/.

import { it } from "node:test";
import { writeFile } from "node:fs/promises";
import { createTempRoot } from "../temp-root.mjs";

const tempRoot = createTempRoot("agent-cortex-failing-workspace-");

it("throws after creating its workspace", async () => {
  const workspace = await tempRoot.createWorkspace();

  const reportPath = process.env.WORKSPACE_REPORT;
  if (reportPath === undefined) throw new Error("WORKSPACE_REPORT must name the file to report to");
  await writeFile(reportPath, `${workspace}\n`);

  throw new Error("deliberate failure after the workspace exists");
});
