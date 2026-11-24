// A boundary hands the window one of two transitions: a stay compacts it, a
// switch flushes it. Neither may run inside the turn that asked for it, so each
// tool arms a request and the `agent_settled` handler acts on it. These tests
// drive the factory through a full `ExtensionAPI` double — a complete literal,
// so a pi release that grows the interface fails `tsc` here rather than dropping
// the check — and they split the two contexts pi builds: the settle handler gets
// `ExtensionContext`, which has `compact()` and no session replacement, while the
// flush command gets `ExtensionCommandContext`, which has `newSession()`.
//
// The single-use rule is the point of the slot: one arming is acted on once, and
// a second tool call arms again.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import sessionTransitionExtension, {
  COMPACT_TOOL,
  FLUSH_COMMAND,
  FLUSH_TOOL,
  effect,
  refusal,
} from "./index.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A handler recorded from `pi.on`, invoked via Reflect.apply so its exact
 *  signature does not leak into the double. */
type RecordedHandler = (...args: never[]) => unknown;

/** The tool result the extension returns, as the double reads it back. */
interface RecordedResult {
  content: Array<{ type: string; text?: string }>;
  details: unknown;
  terminate?: boolean;
}

/** What one `ctx.compact()` call was asked to do. */
interface CompactCall {
  customInstructions: string | undefined;
  onComplete: (() => void) | undefined;
  onError: ((error: Error) => void) | undefined;
}

interface FakeUi {
  notifications: Array<{ message: string; level: string | undefined }>;
  notify(message: string, level?: "info" | "warning" | "error"): void;
}

interface Calls {
  /** Tool names the factory registered, in order. */
  tools: string[];
  /** Command names the factory registered, in order. */
  commands: string[];
  /** Every `ctx.compact()` the settle handler asked for. */
  compactions: CompactCall[];
  /** Every message sent to the agent, which must be commands only. */
  userMessages: Array<{ content: string; options: { expandPromptTemplates?: boolean } | undefined }>;
  /** Every session replacement the flush command asked for. */
  replacements: Array<{
    parentSession?: string;
    setup?: unknown;
    withSession?: unknown;
  }>;
}

interface FakeInstance {
  pi: ExtensionAPI;
  calls: Calls;
  ui: FakeUi;
  /**
   * The context pi builds for event handlers: `compact()` is here, a session
   * replacement is not.
   */
  settleContext(): Record<string, unknown>;
  /** The context pi builds for command handlers, replacement included. */
  commandContext(): Record<string, unknown>;
  runTool(name: string, params: { reason: string }): Promise<{
    text: string;
    details: unknown;
    terminate: boolean | undefined;
    error: Error | undefined;
  }>;
  runCommand(): Promise<void>;
  fireSettled(): Promise<void>;
}

function createFakeInstance(options: { sessionFile?: string; cancel?: boolean } = {}): FakeInstance {
  const calls: Calls = {
    tools: [],
    commands: [],
    compactions: [],
    userMessages: [],
    replacements: [],
  };

  const ui: FakeUi = {
    notifications: [],
    notify(message, level) {
      this.notifications.push({ message, level });
    },
  };

  const handlers = new Map<string, RecordedHandler[]>();
  const tools = new Map<
    string,
    (...args: never[]) => Promise<{
      content: Array<{ type: string; text?: string }>;
      details: unknown;
      terminate?: boolean;
    }>
  >();
  let commandHandler: ((args: string, ctx: never) => Promise<void>) | undefined;

  const sessionFile = options.sessionFile ?? "/sessions/theme.jsonl";

  const sessionManager = {
    getSessionFile: (): string | undefined => sessionFile,
    getLeafId: (): string | null => "leaf-1",
  };

  const pi: ExtensionAPI = {
    on: (event: string, handler: RecordedHandler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
    registerFlag: () => {},
    getFlag: () => undefined,
    getActiveTools: () => [],
    setActiveTools: () => {},
    registerCommand: (name, registered) => {
      calls.commands.push(name);
      commandHandler = registered.handler;
    },
    registerShortcut: () => {},
    registerTool: (definition) => {
      calls.tools.push(definition.name);
      tools.set(definition.name, definition.execute);
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
    sendMessage: () => {},
    sendUserMessage: (content, sendOptions) => {
      assert.equal(typeof content, "string", "a dispatched command is text");
      calls.userMessages.push({
        content: typeof content === "string" ? content : "",
        options: sendOptions,
      });
    },
    appendEntry: () => {},
    setSessionName: () => {},
    getSessionName: () => undefined,
    setLabel: () => {},
    exec: async () => {
      throw new Error("not implemented");
    },
    getAllTools: () => [],
    getSettings: () => {
      throw new Error("not implemented");
    },
    getCommands: () => [],
    setModel: async () => true,
    getThinkingLevel: () => "medium",
    setThinkingLevel: () => {},
    events: { on: () => () => {}, emit: () => {} },
  };

  const baseContext = { ui, cwd: "/workspace", sessionManager };

  /** The event context: no session replacement, exactly as pi builds it. */
  function settleContext(): Record<string, unknown> {
    return {
      ...baseContext,
      isIdle: () => true,
      compact: (compactOptions?: {
        customInstructions?: string;
        onComplete?: () => void;
        onError?: (error: Error) => void;
      }) => {
        calls.compactions.push({
          customInstructions: compactOptions?.customInstructions,
          onComplete: compactOptions?.onComplete,
          onError: compactOptions?.onError,
        });
      },
    };
  }

  /** The command context: the event context plus the replacements pi allows there. */
  function commandContext(): Record<string, unknown> {
    return {
      ...settleContext(),
      waitForIdle: async () => {},
      newSession: async (newSessionOptions?: {
        parentSession?: string;
        setup?: unknown;
        withSession?: unknown;
      }) => {
        calls.replacements.push(newSessionOptions ?? {});
        return { cancelled: options.cancel === true };
      },
    };
  }

  sessionTransitionExtension(pi);

  return {
    pi,
    calls,
    ui,
    settleContext,
    commandContext,
    async runTool(name, params) {
      const execute = tools.get(name);
      assert.ok(execute, `${name} must be registered while the extension loads`);

      try {
        const result = (await Reflect.apply(execute, undefined, [
          "call-1",
          params,
          undefined,
          undefined,
          { ...baseContext, executeTool: async () => undefined },
        ])) as RecordedResult;

        return {
          text: result.content.map((part) => part.text ?? "").join(""),
          details: result.details,
          terminate: result.terminate,
          error: undefined,
        };
      } catch (error) {
        return { text: "", details: undefined, terminate: undefined, error: error as Error };
      }
    },
    async runCommand() {
      assert.ok(commandHandler, `${FLUSH_COMMAND} must be registered while the extension loads`);
      await Reflect.apply(commandHandler, undefined, ["", commandContext()]);
    },
    async fireSettled() {
      for (const handler of handlers.get("agent_settled") ?? []) {
        await Reflect.apply(handler, undefined, [{ type: "agent_settled", aborted: false }, settleContext()]);
      }
    },
  };
}

// ─── Registration ────────────────────────────────────────────────────────────

describe("sessionTransitionExtension", () => {
  it("registers both arming tools and the flush command from the factory", () => {
    const instance = createFakeInstance();

    assert.deepEqual(instance.calls.tools, [COMPACT_TOOL, FLUSH_TOOL]);
    assert.deepEqual(instance.calls.commands, [FLUSH_COMMAND]);
  });

  it("makes no model call while arming: nothing is sent but the flush dispatch", async () => {
    const instance = createFakeInstance();

    await instance.runTool(COMPACT_TOOL, { reason: "the plan bead is closed" });
    await instance.fireSettled();

    assert.deepEqual(instance.calls.userMessages, [], "a compaction is not a command");
  });
});

// ─── Arming ──────────────────────────────────────────────────────────────────

describe("arming a transition", () => {
  it("confirms the compaction and ends the turn", async () => {
    const instance = createFakeInstance();

    const result = await instance.runTool(COMPACT_TOOL, { reason: "the plan bead is closed" });

    assert.equal(result.error, undefined);
    assert.match(result.text, /summarises the window and keeps the recent tail/i);
    assert.match(result.text, /the plan bead is closed/);
    assert.equal(result.terminate, true, "the transition needs the turn over, so the tool ends it");
    assert.deepEqual(result.details, {
      armed: true,
      kind: "compact",
      effect: "summarises the window and keeps the recent tail",
    });
  });

  it("confirms the flush and names no command in the result", async () => {
    const instance = createFakeInstance();

    const result = await instance.runTool(FLUSH_TOOL, { reason: "the theme switched to billing" });

    assert.equal(result.error, undefined);
    assert.match(result.text, /drops the window and carries nothing across/i);
    assert.match(result.text, /the theme switched to billing/);
    assert.equal(result.terminate, true);
    assert.equal(result.text.includes(FLUSH_COMMAND), false, "the mechanism is not the model's concern");
  });

  it("refuses a blank reason on either tool and arms nothing", async () => {
    for (const tool of [COMPACT_TOOL, FLUSH_TOOL]) {
      const instance = createFakeInstance();

      const empty = await instance.runTool(tool, { reason: "" });
      const whitespace = await instance.runTool(tool, { reason: "   \n\t " });

      for (const result of [empty, whitespace]) {
        assert.ok(result.error instanceof Error, `${tool} refuses a blank reason`);
        assert.match(result.error.message, /one-line reason is required/i);
      }

      await instance.fireSettled();
      assert.deepEqual(instance.calls.compactions, [], `${tool} arms no compaction`);
      assert.deepEqual(instance.calls.userMessages, [], `${tool} arms no flush`);
    }
  });

  it("trims the reason it records", async () => {
    const instance = createFakeInstance();

    const result = await instance.runTool(COMPACT_TOOL, { reason: "  the review is given  " });

    assert.match(result.text, /Reason recorded: the review is given$/);
  });
});

// ─── Settling ────────────────────────────────────────────────────────────────

describe("acting on an armed request", () => {
  it("does nothing at all when no transition was armed", async () => {
    const instance = createFakeInstance();

    await instance.fireSettled();

    assert.deepEqual(instance.calls.compactions, []);
    assert.deepEqual(instance.calls.userMessages, []);
    assert.deepEqual(instance.calls.replacements, []);
  });

  it("compacts once with the reason as the summariser's instructions", async () => {
    const instance = createFakeInstance();

    await instance.runTool(COMPACT_TOOL, { reason: "the plan bead is closed" });
    await instance.fireSettled();

    assert.equal(instance.calls.compactions.length, 1);
    assert.equal(instance.calls.compactions[0].customInstructions, "the plan bead is closed");
  });

  it("acts once on one arming, however many settles follow", async () => {
    const instance = createFakeInstance();

    await instance.runTool(COMPACT_TOOL, { reason: "the plan bead is closed" });
    await instance.fireSettled();
    await instance.fireSettled();

    assert.equal(instance.calls.compactions.length, 1, "the request is single-use");
  });

  it("acts once when the same transition is armed twice before it settles", async () => {
    const instance = createFakeInstance();

    await instance.runTool(COMPACT_TOOL, { reason: "the first item is done" });
    await instance.runTool(COMPACT_TOOL, { reason: "the second item is done" });
    await instance.fireSettled();
    await instance.fireSettled();

    assert.equal(instance.calls.compactions.length, 1);
    assert.equal(
      instance.calls.compactions[0].customInstructions,
      "the second item is done",
      "the newest arming is the one acted on",
    );
  });

  it("arms again on a second tool call after the first was acted on", async () => {
    const instance = createFakeInstance();

    await instance.runTool(COMPACT_TOOL, { reason: "the first item is done" });
    await instance.fireSettled();
    await instance.runTool(COMPACT_TOOL, { reason: "the second item is done" });
    await instance.fireSettled();

    assert.equal(instance.calls.compactions.length, 2);
    assert.equal(instance.calls.compactions[1].customInstructions, "the second item is done");
  });

  it("dispatches the flush command instead of compacting", async () => {
    const instance = createFakeInstance();

    await instance.runTool(FLUSH_TOOL, { reason: "the theme switched to billing" });
    await instance.fireSettled();

    assert.deepEqual(instance.calls.compactions, [], "a flush is not a compaction");
    assert.deepEqual(instance.calls.userMessages, [
      { content: `/${FLUSH_COMMAND}`, options: { expandPromptTemplates: true } },
    ]);
    assert.equal(instance.calls.replacements.length, 0, "the event context cannot replace the session");
  });

  it("does not fire an unarmed flush after a compact", async () => {
    const instance = createFakeInstance();

    await instance.runTool(COMPACT_TOOL, { reason: "the plan bead is closed" });
    await instance.fireSettled();
    await instance.fireSettled();

    assert.equal(instance.calls.compactions.length, 1);
    assert.deepEqual(instance.calls.userMessages, [], "a spent compaction arms no flush");
  });

  it("reports a failed compaction and leaves the session alone", async () => {
    const instance = createFakeInstance();

    await instance.runTool(COMPACT_TOOL, { reason: "the plan bead is closed" });
    await instance.fireSettled();

    instance.calls.compactions[0].onError?.(new Error("provider refused"));

    assert.deepEqual(instance.ui.notifications, [
      {
        message: "Compaction failed: provider refused. The window is unchanged; continue in it.",
        level: "error",
      },
    ]);
  });
});

// ─── Flushing ────────────────────────────────────────────────────────────────

describe(`${FLUSH_COMMAND}`, () => {
  it("replaces the session and seeds nothing into the replacement", async () => {
    const instance = createFakeInstance({ sessionFile: "/sessions/theme.jsonl" });

    await instance.runTool(FLUSH_TOOL, { reason: "the theme switched to billing" });
    await instance.fireSettled();
    await instance.runCommand();

    // The one call, and its whole option object: a replacement that names a
    // parent records lineage, and a replacement that seeds anything names it here.
    assert.deepEqual(
      instance.calls.replacements.map((replacement) => Object.keys(replacement)),
      [["parentSession"]],
      "the replacement is asked for with a parent and nothing else",
    );
    assert.deepEqual(
      instance.calls.replacements.map((replacement) => replacement.parentSession),
      ["/sessions/theme.jsonl"],
    );
  });

  it("carries the reason to the human, never into the replacement", async () => {
    const instance = createFakeInstance();

    await instance.runTool(FLUSH_TOOL, { reason: "the theme switched to billing" });
    await instance.fireSettled();
    await instance.runCommand();

    assert.deepEqual(instance.ui.notifications, [
      { message: "Flushing the window: the theme switched to billing", level: "info" },
    ]);
  });

  it("reports a cancelled replacement without claiming the window was flushed", async () => {
    const instance = createFakeInstance({ cancel: true });

    await instance.runTool(FLUSH_TOOL, { reason: "the theme switched to billing" });
    await instance.fireSettled();
    await instance.runCommand();

    assert.deepEqual(instance.ui.notifications, [
      { message: "Flushing the window: the theme switched to billing", level: "info" },
      { message: "The flush was cancelled. The window is unchanged.", level: "warning" },
    ]);
  });

  it("replaces nothing when no flush is pending", async () => {
    const instance = createFakeInstance();

    await instance.runCommand();

    assert.deepEqual(instance.calls.replacements, []);
    assert.deepEqual(instance.ui.notifications, [
      { message: "No flush was armed, so nothing was flushed.", level: "warning" },
    ]);
  });

  it("acts once, so a second invocation finds nothing pending", async () => {
    const instance = createFakeInstance();

    await instance.runTool(FLUSH_TOOL, { reason: "the theme switched to billing" });
    await instance.fireSettled();
    await instance.runCommand();
    await instance.runCommand();

    assert.equal(instance.calls.replacements.length, 1);
  });
});

// ─── The shared vocabulary ───────────────────────────────────────────────────

describe("the transition vocabulary", () => {
  it("names the effect of each transition the boundary decides", () => {
    assert.equal(effect("compact"), "summarises the window and keeps the recent tail");
    assert.equal(effect("flush"), "drops the window and carries nothing across");
  });

  it("refuses only a blank reason", () => {
    assert.equal(refusal("the plan bead is closed"), undefined);
    assert.match(refusal("  ") ?? "", /one-line reason is required/);
  });
});
