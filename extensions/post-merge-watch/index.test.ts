import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createTempRoot } from "../../test/helpers/temp-root.mjs";
import postMergeWatchExtension, { CHECK_SCRIPT_ENV, WATCH_FLAG, checkScript } from "./index.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const tempRoot = createTempRoot("post-merge-watch-index-");

interface FlagRegistration {
  name: string;
  options: { description?: string; type: "string" | "boolean"; default?: string | boolean };
}

interface SentMessage {
  message: { customType: string; content: string | unknown[]; display: boolean; details?: unknown };
  options: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" } | undefined;
}

interface ExecCall {
  command: string;
  args: string[];
  options: { cwd?: string; timeout?: number } | undefined;
}

/** An event handler as `pi.on` recorded it, called through `Reflect.apply`. */
type RecordedHandler = (...args: never[]) => unknown;

interface FakePi {
  pi: ExtensionAPI;
  flags: FlagRegistration[];
  sent: SentMessage[];
  execs: ExecCall[];
  notifications: Array<{ message: string; type: string | undefined }>;
  /** Fire every handler pi registered for `event`. */
  fire(event: string, payload: unknown, context: unknown): Promise<void>;
}

/**
 * A double for the five `ExtensionAPI` members this extension reaches.
 *
 * Deliberately partial: the complete-literal guard is
 * `extensions/agent-modes/index.test.ts`, whose fake fails `tsc` when pi's
 * interface grows a member.
 */
function createFakePi(options: {
  flag: string | undefined;
  scriptExitCode: number;
  scriptStdout?: string;
}): FakePi {
  const flags: FlagRegistration[] = [];
  const sent: SentMessage[] = [];
  const execs: ExecCall[] = [];
  const notifications: Array<{ message: string; type: string | undefined }> = [];
  const handlers = new Map<string, RecordedHandler[]>();

  const pi = {
    registerFlag: (name: string, registration: FlagRegistration["options"]) => {
      flags.push({ name, options: registration });
    },
    getFlag: (name: string) => (name === WATCH_FLAG ? options.flag : undefined),
    on: (event: string, handler: RecordedHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    },
    exec: async (command: string, args: string[], execOptions: ExecCall["options"]) => {
      execs.push({ command, args, options: execOptions });
      return {
        stdout: options.scriptStdout ?? "",
        stderr: "",
        code: options.scriptExitCode,
        killed: false,
        truncated: false,
      };
    },
    sendMessage: (message: SentMessage["message"], sendOptions?: SentMessage["options"]) => {
      sent.push({ message, options: sendOptions });
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    flags,
    sent,
    execs,
    notifications,
    async fire(event, payload, context) {
      for (const handler of handlers.get(event) ?? []) {
        await Reflect.apply(handler, undefined, [
          payload,
          {
            cwd: "/projects/one",
            ui: { notify: (message: string, type?: string) => notifications.push({ message, type }) },
            ...(context as object),
          },
        ]);
      }
    },
  };
}

/** The startup event pi sends before a session is usable. */
const SESSION_START = { type: "session_start", reason: "startup" } as const;

/** Run one session start with `HOME` pointed at a temp root, so no test reads the real home. */
async function withTempHome<T>(run: (home: string) => Promise<T>): Promise<T> {
  const home = await tempRoot.createWorkspace();
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    return await run(home);
  } finally {
    process.env.HOME = previousHome;
  }
}

/** The state directory the extension uses for a given home. */
function stateDirFor(home: string): string {
  return join(home, ".pi", "agent-cortex", "post-merge-watch");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ─── Flag registration ───────────────────────────────────────────────────────

describe("post-merge-watch extension", () => {
  it("registers its CLI flag in the factory, before any session starts", async () => {
    const fake = createFakePi({ flag: undefined, scriptExitCode: 2 });

    postMergeWatchExtension(fake.pi);

    assert.deepEqual(
      fake.flags.map((flag) => ({ name: flag.name, type: flag.options.type })),
      [{ name: "post-merge-watch", type: "string" }],
    );
  });

  it("resolves the shipped check script without a hardcoded absolute path", () => {
    const previous = process.env[CHECK_SCRIPT_ENV];
    delete process.env[CHECK_SCRIPT_ENV];
    try {
      assert.match(checkScript(), /skills[/\\]workflow[/\\]ralph[/\\]scripts[/\\]post-merge-check\.mjs$/);
    } finally {
      if (previous !== undefined) process.env[CHECK_SCRIPT_ENV] = previous;
    }
  });

  it("polls the script the environment names, so an install can be pointed at a stub", async () => {
    const previous = process.env[CHECK_SCRIPT_ENV];
    process.env[CHECK_SCRIPT_ENV] = "/stub/post-merge-check.mjs";
    try {
      assert.equal(checkScript(), "/stub/post-merge-check.mjs");
    } finally {
      if (previous === undefined) delete process.env[CHECK_SCRIPT_ENV];
      else process.env[CHECK_SCRIPT_ENV] = previous;
    }
  });

  // ─── Session lifecycle ─────────────────────────────────────────────────────

  it("starts one watch at session start and wakes the session when the check settles", async () => {
    await withTempHome(async (home) => {
      const fake = createFakePi({
        flag: "agnt-ctx-86u4.2",
        scriptExitCode: 1,
        scriptStdout: JSON.stringify({ reason: "run-failed", runs: [{ url: "https://gh/run/9" }] }),
      });
      postMergeWatchExtension(fake.pi);

      await fake.fire("session_start", SESSION_START, {});

      assert.equal(fake.execs.length, 1);
      assert.deepEqual(
        { args: fake.execs[0].args.slice(1), cwd: fake.execs[0].options?.cwd },
        { args: ["--wait", "0"], cwd: "/projects/one" },
      );
      assert.equal(fake.sent.length, 1);
      assert.deepEqual(fake.sent[0].options, { deliverAs: "followUp", triggerTurn: true });
      assert.match(fake.sent[0].message.content as string, /agnt-ctx-86u4\.2/);
      assert.deepEqual(fake.sent[0].message.details, {
        bead: "agnt-ctx-86u4.2",
        verdict: "failed",
        runUrl: "https://gh/run/9",
        exitCode: 1,
        reason: "run-failed",
        attempts: 1,
        project: "/projects/one",
      });
    });
  });

  it("starts no watch when the flag is absent", async () => {
    await withTempHome(async (home) => {
      const fake = createFakePi({ flag: undefined, scriptExitCode: 1 });
      postMergeWatchExtension(fake.pi);

      await fake.fire("session_start", SESSION_START, {});

      assert.deepEqual(fake.execs, []);
      assert.equal(await exists(stateDirFor(home)), false);
    });
  });

  it("records the watch under the agent-cortex state directory, then clears it on session shutdown", async () => {
    await withTempHome(async (home) => {
      const fake = createFakePi({ flag: "agnt-ctx-86u4.2", scriptExitCode: 2 });
      postMergeWatchExtension(fake.pi);

      await fake.fire("session_start", SESSION_START, {});

      assert.deepEqual(
        (await readdir(stateDirFor(home))).length,
        1,
        "the in-flight watch is recorded under ~/.pi/agent-cortex",
      );
      assert.equal(fake.sent.length, 0, "no verdict yet, so no wake");

      await fake.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, {});

      assert.deepEqual(await readdir(stateDirFor(home)), [], "an abandoned watch leaves no state file");
      assert.deepEqual(fake.sent, [], "an abandoned watch wakes nobody");
    });
  });

  it("starts no second watch when the session reloads for the same bead", async () => {
    await withTempHome(async () => {
      const fake = createFakePi({ flag: "agnt-ctx-86u4.2", scriptExitCode: 2 });
      postMergeWatchExtension(fake.pi);

      await fake.fire("session_start", SESSION_START, {});
      await fake.fire("session_start", { type: "session_start", reason: "reload" }, {});

      assert.equal(fake.execs.length, 1);
    });
  });
});
