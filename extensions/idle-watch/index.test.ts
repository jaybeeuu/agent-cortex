import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import idleWatchExtension, {
  CHECK_ENV,
  CHECK_TIMEOUT_MS,
  TOOL_NAME,
  execRunner,
  resolveScript,
} from "./index.ts";
import type { CommandInvocation, TickRun } from "./watch.ts";
import { DEFAULT_INTERVAL_MS } from "./watch.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** The package root the extension resolves a relative check against. */
const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

interface ExecCall {
  command: string;
  args: string[];
  options: { cwd?: string; timeout?: number } | undefined;
}

/**
 * What the tool needs from the session context: a directory to run the check in
 * and a way to report a problem. Deliberately narrow — the complete-literal
 * guard for `ExtensionAPI` itself is the fake below, which fails `tsc` when pi's
 * interface grows a member.
 */
interface WatchContext {
  cwd: string;
  ui: { notify(message: string, level?: string): void };
}

/** One registered tool, narrowed to the members these tests call. */
interface RegisteredTool {
  name: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: { action?: "start" | "stop" | "status"; command?: string },
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: WatchContext,
  ): Promise<ToolOutcome>;
}

interface ToolOutcome {
  content: Array<{ type: string; text?: string }>;
  details: unknown;
  terminate?: boolean;
}

/** One message the extension handed to `pi.sendMessage`. */
interface SentMessage {
  customType: string;
  content: string | Array<{ type?: string; text?: string }>;
  options: unknown;
}

/** An event handler as `pi.on` recorded it, called through `Reflect.apply`. */
type RecordedHandler = (...args: never[]) => unknown;

interface FakePi {
  pi: ExtensionAPI;
  tools: RegisteredTool[];
  sent: SentMessage[];
  execs: ExecCall[];
  notifications: Array<{ message: string; level: string | undefined }>;
  /** Fire every handler pi registered for `event`. */
  fire(event: string, payload: unknown, context: unknown): Promise<void>;
}

/**
 * A complete `ExtensionAPI` test double: every member is a literal, so a pi
 * release that grows the interface fails `tsc` here rather than being cast away.
 */
function createFakePi(run: TickRun = { code: 0, stdout: "{}", stderr: "", killed: false }): FakePi {
  const tools: RegisteredTool[] = [];
  const sent: SentMessage[] = [];
  const execs: ExecCall[] = [];
  const notifications: Array<{ message: string; level: string | undefined }> = [];
  const handlers = new Map<string, RecordedHandler[]>();

  const pi: ExtensionAPI = {
    on: (event: string, handler: RecordedHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    },
    registerFlag: () => {},
    getFlag: () => undefined,
    getActiveTools: () => [],
    setActiveTools: () => {},
    registerCommand: () => {},
    registerShortcut: () => {},
    registerTool: (tool) => {
      tools.push(tool);
    },
    registerMessageRenderer: () => {},
    registerMarkdownTransformer: () => {},
    registerEntryRenderer: () => {},
    registerToolRenderer: () => {},
    registerProvider: () => {},
    unregisterProvider: () => {},
    registerMcpServer: () => {},
    unregisterMcpServer: () => {},
    unregisterVirtualModel: () => {},
    registerVirtualModel: () => {},
    getMcpServers: () => [],
    sendMessage: (message, options) => {
      sent.push({ customType: message.customType, content: message.content, options });
    },
    sendUserMessage: () => {},
    appendEntry: () => {},
    setSessionName: () => {},
    getSessionName: () => undefined,
    setLabel: () => {},
    exec: async (command: string, args: string[], options?: ExecCall["options"]) => {
      execs.push({ command, args, options });
      return { ...run, truncated: false };
    },
    getAllTools: () => [],
    getSettings: () => {
      throw new Error("not implemented");
    },
    getCommands: () => [],
    setModel: async () => false,
    getThinkingLevel: () => "off",
    setThinkingLevel: () => {},
    events: { on: () => () => {}, emit: () => {} },
  };

  return {
    pi,
    tools,
    sent,
    execs,
    notifications,
    async fire(event, payload, context) {
      for (const handler of handlers.get(event) ?? []) {
        await Reflect.apply(handler, undefined, [payload, context]);
      }
    },
  };
}

/** The session context the tool receives, complete enough for the members it reads. */
function createContext(): WatchContext {
  return { cwd: "/projects/one", ui: { notify: () => {} } };
}

/** The words one tool result or sent message carries. */
function textOf(carrier: { content: string | Array<{ type?: string; text?: string }> }): string {
  return typeof carrier.content === "string"
    ? carrier.content
    : carrier.content.map((block) => block.text ?? "").join("");
}

/** The one tool this extension registers. */
function registeredTool(fake: FakePi): RegisteredTool {
  const tool = fake.tools[0];
  assert.ok(tool, "the extension should register exactly one tool");
  return tool;
}

/** Run one tool call against the fake session. */
async function call(
  fake: FakePi,
  params: { action?: "start" | "stop" | "status"; command?: string },
): Promise<ToolOutcome> {
  return registeredTool(fake).execute("call-1", params, undefined, undefined, createContext());
}

/** Run `body` with `CHECK_ENV` set, so no test inherits another's environment. */
async function withCheckEnv(value: string | undefined, body: () => Promise<void>): Promise<void> {
  const previous = process.env[CHECK_ENV];
  if (value === undefined) delete process.env[CHECK_ENV];
  else process.env[CHECK_ENV] = value;
  try {
    await body();
  } finally {
    if (previous === undefined) delete process.env[CHECK_ENV];
    else process.env[CHECK_ENV] = previous;
  }
}

// ─── Registration ────────────────────────────────────────────────────────────

describe("idle-watch extension registration", () => {
  it("registers its one tool in the factory, before any session starts", () => {
    const fake = createFakePi();

    idleWatchExtension(fake.pi);

    assert.equal(fake.tools.length, 1);
    const tool = registeredTool(fake);
    assert.equal(tool.name, TOOL_NAME);
    assert.match(tool.description, /returns at once/);
    assert.match(tool.description, /status/);
    assert.ok(tool.parameters, "the tool declares a parameter schema");
  });

  it("does nothing else at load time: no child process and no message", () => {
    const fake = createFakePi();

    idleWatchExtension(fake.pi);

    assert.deepEqual(fake.execs, []);
    assert.deepEqual(fake.sent, []);
  });
});

// ─── Check resolution ────────────────────────────────────────────────────────

describe("resolveScript", () => {
  it("resolves a relative script against the package, not the caller's directory", () => {
    assert.equal(resolveScript("skills/workflow/ralph/scripts/idle-check.mjs"), join(PACKAGE_ROOT, "skills", "workflow", "ralph", "scripts", "idle-check.mjs"));
  });

  it("keeps an absolute script as given, so a test can point at a stub", () => {
    assert.equal(resolveScript("/tmp/stub/idle-check.mjs"), "/tmp/stub/idle-check.mjs");
  });

  it("resolves nothing when the configuration is absent or blank", () => {
    assert.equal(resolveScript(undefined), undefined);
    assert.equal(resolveScript(""), undefined);
    assert.equal(resolveScript("   "), undefined);
  });
});

describe("execRunner", () => {
  it("runs the check with the session's executor, in the project, under the timeout", async () => {
    const fake = createFakePi({ code: 1, stdout: '{"ready":[]}', stderr: "boom", killed: false });
    const invocation: CommandInvocation = { script: "/checks/idle.mjs", cwd: "/projects/one" };

    const run = await execRunner(fake.pi)(invocation);

    assert.deepEqual(fake.execs, [
      {
        command: process.execPath,
        args: ["/checks/idle.mjs"],
        options: { cwd: "/projects/one", timeout: CHECK_TIMEOUT_MS },
      },
    ]);
    assert.deepEqual(run, { code: 1, stdout: '{"ready":[]}', stderr: "boom", killed: false });
  });
});

// ─── The tool ────────────────────────────────────────────────────────────────

describe("idle_watch tool", () => {
  it("arms a watch, returns before any check runs, and ends the turn", async () => {
    await withCheckEnv("/checks/idle.mjs", async () => {
      const fake = createFakePi();
      idleWatchExtension(fake.pi);

      const outcome = await call(fake, { action: "start" });

      assert.equal(outcome.terminate, true, "the turn ends, so the session stays interactive");
      assert.deepEqual(fake.execs, [], "the first tick is scheduled, not run");
      assert.match(textOf(outcome), /\/checks\/idle\.mjs/);
      assert.deepEqual(
        { watching: (outcome.details as { watching: boolean }).watching },
        { watching: true },
      );
    });
  });

  it("delivers one follow-up that starts a turn, naming the changed ids, when a tick finds a change", async (t) => {
    // The watch schedules on the real timer at its documented base interval, so
    // the test owns the clock: advancing it runs one tick, and one setImmediate
    // settles the tick's promise chain. Nothing sleeps and nothing polls.
    t.mock.timers.enable({ apis: ["setTimeout"] });

    await withCheckEnv("/checks/idle.mjs", async () => {
      const fake = createFakePi({
        code: 0,
        stdout: '{"ready":[{"id":"agnt-ctx-1"}]}',
        stderr: "",
        killed: false,
      });
      idleWatchExtension(fake.pi);

      await call(fake, { action: "start" });
      t.mock.timers.tick(DEFAULT_INTERVAL_MS);
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(fake.execs.length, 1, "the tick ran the configured check");
      assert.equal(fake.sent.length, 1, "the change reaches the session once, through pi");
      assert.deepEqual(fake.sent[0].options, { deliverAs: "followUp", triggerTurn: true });
      assert.match(textOf(fake.sent[0]), /ready:agnt-ctx-1/);
    });
  });

  it("refuses to arm a watch with no configured check and words the fix", async () => {
    await withCheckEnv(undefined, async () => {
      const fake = createFakePi();
      idleWatchExtension(fake.pi);

      await assert.rejects(() => call(fake, { action: "start" }), new RegExp(CHECK_ENV));
      assert.deepEqual(fake.execs, []);
      assert.match(textOf(await call(fake, { action: "status" })), /No idle watch/);
    });
  });

  it("takes the check from the tool call in preference to the environment", async () => {
    await withCheckEnv("/checks/from-env.mjs", async () => {
      const fake = createFakePi();
      idleWatchExtension(fake.pi);

      const outcome = await call(fake, { action: "start", command: "skills/idle-check.mjs" });

      assert.ok(
        textOf(outcome).includes(join(PACKAGE_ROOT, "skills", "idle-check.mjs")),
        "the call's command wins over the environment, resolved against the package",
      );
    });
  });

  it("reports a session that has never armed a watch", async () => {
    const fake = createFakePi();
    idleWatchExtension(fake.pi);

    const outcome = await call(fake, { action: "status" });

    assert.match(textOf(outcome), /No idle watch/);
    assert.deepEqual(fake.execs, []);
    assert.deepEqual(fake.sent, []);
  });

  it("reports the watch it armed, without polling", async () => {
    await withCheckEnv("/checks/idle.mjs", async () => {
      const fake = createFakePi();
      idleWatchExtension(fake.pi);
      await call(fake, { action: "start" });

      const outcome = await call(fake, { action: "status" });

      assert.match(textOf(outcome), /watching/);
      assert.match(textOf(outcome), /Checks run: 0 of 40/);
      assert.match(textOf(outcome), /Budget left: 40/);
      assert.deepEqual(fake.execs, [], "a status call runs no check");
    });
  });

  it("stops the watch it armed, and a second stop changes nothing", async () => {
    await withCheckEnv("/checks/idle.mjs", async () => {
      const fake = createFakePi();
      idleWatchExtension(fake.pi);
      await call(fake, { action: "start" });

      const stopped = await call(fake, { action: "stop" });
      assert.match(textOf(stopped), /stopped/);
      assert.equal((stopped.details as { watching: boolean }).watching, false);

      const again = await call(fake, { action: "stop" });
      assert.match(textOf(again), /No idle watch is running/);
    });
  });

  it("stops the watch when the session shuts down, leaving no timer armed", async () => {
    await withCheckEnv("/checks/idle.mjs", async () => {
      const fake = createFakePi();
      idleWatchExtension(fake.pi);
      await call(fake, { action: "start" });

      await fake.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, createContext());

      const status = await call(fake, { action: "status" });
      assert.equal((status.details as { watching: boolean }).watching, false);
      assert.match(textOf(status), /stopped/);
    });
  });

  it("replaces a running watch rather than arming a second one", async (t) => {
    // Two live cadences are user-visible: the superseded watch keeps its own
    // timer and delivers a second nudge for the same change. So the test does
    // not read the new watch's status alone — it counts what actually ran and
    // what actually arrived.
    t.mock.timers.enable({ apis: ["setTimeout"] });

    await withCheckEnv("/checks/idle.mjs", async () => {
      const fake = createFakePi({
        code: 0,
        stdout: '{"ready":[{"id":"agnt-ctx-1"}]}',
        stderr: "",
        killed: false,
      });
      idleWatchExtension(fake.pi);
      await call(fake, { action: "start" });
      await call(fake, { action: "start" });

      const status = await call(fake, { action: "status" });
      assert.match(textOf(status), /watching/);
      assert.match(textOf(status), /Checks run: 0 of 40/, "the replacement starts with a fresh budget");

      t.mock.timers.tick(DEFAULT_INTERVAL_MS);
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(
        fake.execs.length,
        1,
        "only the replacement watches: the superseded watch's timer is cancelled, so one interval runs one check",
      );
      assert.equal(fake.sent.length, 1, "the superseded watch delivers nothing");
    });
  });
});
