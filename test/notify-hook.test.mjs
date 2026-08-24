// Tests for the Claude Code Notification hook script (hooks/claude/scripts/notify.mjs).
// The script reads the Notification hook JSON payload from stdin and prints a
// `{ "terminalSequence": "..." }` JSON response that Claude Code emits for us
// (hooks run without a controlling terminal, so OSC sequences must go through
// terminalSequence — see the Claude Code hooks reference).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "hooks", "claude", "scripts", "notify.mjs");

/** Run the hook script with the given payload on stdin and a controlled env. */
function runNotify(payload, env = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [SCRIPT],
      { env, timeout: 10_000 },
      (error, stdout, stderr) => {
        resolve({ exitCode: error ? error.code ?? 1 : 0, stdout, stderr });
      },
    );
    child.stdin.end(JSON.stringify(payload));
  });
}

describe("notify.mjs (Claude Notification hook)", () => {
  it("emits an OSC 777 desktop notification on a bare-terminal success payload", async () => {
    const { exitCode, stdout } = await runNotify(
      { notification_type: "success", title: "task done", message: "all tests pass" },
      { PATH: process.env.PATH },
    );
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(out.terminalSequence.startsWith("\u001b]777;notify;"));
    assert.match(out.terminalSequence, /task done/);
    assert.match(out.terminalSequence, /all tests pass/);
  });

  it("switches to OSC 99 when running inside Kitty", async () => {
    const { exitCode, stdout } = await runNotify(
      { notification_type: "error", title: "failed", message: "build broke" },
      { PATH: process.env.PATH, KITTY_WINDOW_ID: "0" },
    );
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(out.terminalSequence.startsWith("\u001b]99;"));
    assert.match(out.terminalSequence, /build broke/);
  });

  it("stays silent (no output, exit 0) when the payload has no message", async () => {
    const { exitCode, stdout } = await runNotify(
      { notification_type: "success" },
      { PATH: process.env.PATH },
    );
    assert.equal(exitCode, 0);
    assert.equal(stdout, "");
  });
});