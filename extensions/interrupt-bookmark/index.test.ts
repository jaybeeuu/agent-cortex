import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import interruptBookmarkExtension, {
  CHECKPOINT_TOOL,
  RESUME_TOOL,
  REWIND_ATTEMPTS,
  REWIND_COMMAND,
  REWIND_ENTRY,
  SUMMARY_LABEL,
  summariserInstructions,
} from "./index.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A session entry, as the extension reads it. */
interface FakeEntry {
  id: string;
  type: "message" | "branch_summary" | "label" | "custom";
  parentId: string | null;
  /** The branch a summary abandoned, as pi records it. */
  fromId?: string | null;
}

/** What the fake navigation does on its next attempt. */
type NavigationBehaviour = "succeed" | "fail" | "cancel";

interface FakeSession {
  /** The position the session is on. */
  leafId: string | null;
  /** Append-only, exactly as a session file is. */
  entries: FakeEntry[];
  /** Labels applied to entries, in order. */
  labels: Array<{ id: string; label: string }>;
  /** Consumed one per navigation attempt; "succeed" once exhausted. */
  behaviour: NavigationBehaviour[];
  /** True while an agent response is active; only a wait for idle clears it. */
  streaming: boolean;
}

interface FakeUi {
  notifications: Array<{ message: string; level: string | undefined }>;
  notify(message: string, level?: string): void;
}

/** Every navigation attempt, with the options the extension passed. */
interface Attempt {
  targetId: string;
  options: Record<string, unknown> | undefined;
  /** Whether a wait for idle preceded this attempt. */
  waited: boolean;
}

interface Calls {
  tools: string[];
  commands: string[];
  /** Ordered record of the waits and the navigations. */
  order: string[];
  attempts: Attempt[];
  entries: Array<{ customType: string; data: unknown }>;
  /** Anything sent to the model, and how. */
  userMessages: Array<{ content: unknown; options: unknown }>;
  messages: unknown[];
  /** Every session-manager member the extension named, in order, repeats kept. */
  sessionManagerMembers: string[];
}

interface FakeInstance {
  pi: ExtensionAPI;
  session: FakeSession;
  /** The session surface the extension reaches, exactly as the double provides it. */
  sessionManager: {
    getLeafId(): string | null;
    getEntry(id: string): FakeEntry | undefined;
    getEntries(): FakeEntry[];
  };
  calls: Calls;
  ui: FakeUi;
  /** Run a registered tool the way pi does, via Reflect.apply so the exact
   *  signature does not leak into the fake. */
  runTool(name: string, params: Record<string, unknown>): Promise<ToolOutcome>;
  runCommand(args: string): Promise<void>;
  fireSettled(): Promise<void>;
}

interface ToolOutcome {
  text: string;
  details: unknown;
  terminate: boolean | undefined;
  error: Error | undefined;
}

function entry(id: string, parentId: string | null, type: FakeEntry["type"] = "message"): FakeEntry {
  return { id, parentId, type };
}

/**
 * A session that already holds a task turn, an interruption and its follow-up:
 *
 *   m1 → m2 → m3 → m4
 *
 * `m2` is the checkpoint; `m3` and `m4` are the interrupt's turns.
 */
function interruptedSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    leafId: "m4",
    entries: [entry("m1", null), entry("m2", "m1"), entry("m3", "m2"), entry("m4", "m3")],
    labels: [],
    behaviour: [],
    streaming: false,
    ...overrides,
  };
}

/**
 * Build a full `ExtensionAPI` test double.
 *
 * The literal is complete, so `tsc` fails when a pi release grows the interface.
 * Every method that would reach a provider or the user is recorded, so a test can
 * assert that the extension made no model call of its own.
 */
function createFakeInstance(session: FakeSession): FakeInstance {
  const calls: Calls = {
    tools: [],
    commands: [],
    order: [],
    attempts: [],
    entries: [],
    userMessages: [],
    messages: [],
    sessionManagerMembers: [],
  };
  const ui: FakeUi = {
    notifications: [],
    notify(message, level) {
      this.notifications.push({ message, level });
    },
  };

  const state = session;
  const handlers = new Map<string, Array<(...args: never[]) => unknown>>();
  const tools = new Map<string, { execute: (...args: never[]) => Promise<unknown> }>();
  let commandHandler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
  let waitedSinceLastAttempt = false;
  let summaryCount = 0;

  /** The session surface the double provides. Reads only: no delete or truncate member. */
  const sessionReads = {
    getLeafId: () => state.leafId,
    getEntry: (id: string) => state.entries.find((candidate) => candidate.id === id),
    getEntries: () => state.entries,
  };

  /**
   * The same surface, recording every member the extension names. A member the
   * double does not implement is recorded and then treated as a no-op, so a call
   * the extension starts making is reported by name from the assertion rather
   * than crashing inside a tool call.
   */
  const sessionManager = new Proxy(sessionReads, {
    get(target, property, receiver) {
      const member: unknown = Reflect.get(target, property, receiver);
      if (typeof property !== "string") return member;
      calls.sessionManagerMembers.push(property);
      return member ?? (() => undefined);
    },
  });

  /** The command context pi builds for command handlers, and for nothing else. */
  const commandContext = {
    ui,
    cwd: "/workspace",
    sessionManager,
    waitForIdle: async () => {
      calls.order.push("waitForIdle");
      waitedSinceLastAttempt = true;
      state.streaming = false;
    },
    navigateTree: async (targetId: string, options?: Record<string, unknown>) => {
      calls.order.push("navigateTree");
      calls.attempts.push({ targetId, options, waited: waitedSinceLastAttempt });
      waitedSinceLastAttempt = false;

      // pi rejects navigation while a response is active, exactly as the session
      // does: the active branch is left unchanged and the promise rejects.
      if (state.streaming) {
        throw new Error("Wait for the current response to finish before navigating the session tree.");
      }

      const behaviour = state.behaviour.shift() ?? "succeed";
      if (behaviour === "fail") {
        throw new Error(
          "Wait for the current compaction or tree navigation to finish before navigating the session tree.",
        );
      }
      if (behaviour === "cancel") {
        return { cancelled: true };
      }

      summaryCount += 1;
      const summaryId = `summary-${summaryCount}`;
      const fromId = state.leafId;
      state.entries.push({ ...entry(summaryId, targetId, "branch_summary"), fromId });
      state.leafId = summaryId;

      // pi appends a label entry on top of the summary, so the leaf after a
      // labelled navigation is the label entry, not the summary. Verified
      // against the real SessionManager (see README, "Proven against pi").
      const label = options?.label;
      if (typeof label === "string") {
        state.labels.push({ id: summaryId, label });
        const labelId = `label-${state.labels.length}`;
        state.entries.push(entry(labelId, summaryId, "label"));
        state.leafId = labelId;
      }

      return { cancelled: false, editorText: undefined, summaryEntry: { id: summaryId, fromId } };
    },
  };

  const pi: ExtensionAPI = {
    on: (event: string, handler: (...args: never[]) => unknown) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
    registerFlag: () => {},
    getFlag: () => undefined,
    getActiveTools: () => [],
    setActiveTools: () => {},
    registerCommand: (name, options) => {
      calls.commands.push(name);
      commandHandler = options.handler as typeof commandHandler;
    },
    registerShortcut: () => {},
    registerTool: (definition) => {
      calls.tools.push(definition.name);
      tools.set(
        definition.name,
        definition as unknown as { execute: (...args: never[]) => Promise<unknown> },
      );
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
    sendMessage: (message) => {
      calls.messages.push(message);
    },
    sendUserMessage: (content, options) => {
      calls.userMessages.push({ content, options });
    },
    appendEntry: (customType, data) => {
      calls.entries.push({ customType, data });
      const id = `custom-${calls.entries.length}`;
      state.entries.push(entry(id, state.leafId, "custom"));
      state.leafId = id;
    },
    setSessionName: () => {},
    getSessionName: () => undefined,
    setLabel: (id, label) => {
      if (label !== undefined) state.labels.push({ id, label });
    },
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

  const instance: FakeInstance = {
    pi,
    session: state,
    sessionManager,
    calls,
    ui,
    async runTool(name, params) {
      const tool = tools.get(name);
      assert.ok(tool, `${name} must be registered while the extension loads`);

      const toolContext = { ui, cwd: "/workspace", sessionManager };

      try {
        const result = (await Reflect.apply(tool.execute, tool, [
          "call-1",
          params,
          undefined,
          undefined,
          toolContext,
        ])) as {
          content: Array<{ type: string; text?: string }>;
          details: unknown;
          terminate?: boolean;
        };
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
    async runCommand(args) {
      assert.ok(commandHandler, `${REWIND_COMMAND} must be registered while the extension loads`);
      await Reflect.apply(commandHandler, undefined, [args, commandContext]);
    },
    async fireSettled() {
      for (const handler of handlers.get("agent_settled") ?? []) {
        await Reflect.apply(handler, undefined, [{ type: "agent_settled", aborted: false }, commandContext]);
      }
    },
  };

  interruptBookmarkExtension(pi);
  return instance;
}

/** The ids a session holds, in order. */
function ids(session: FakeSession): string[] {
  return session.entries.map((held) => held.id);
}

// ─── Registration ────────────────────────────────────────────────────────────

describe("interruptBookmarkExtension", () => {
  it("registers both tools and the rewind command from the factory", () => {
    const instance = createFakeInstance(interruptedSession());

    assert.deepEqual(instance.calls.tools, [CHECKPOINT_TOOL, RESUME_TOOL]);
    assert.deepEqual(instance.calls.commands, [REWIND_COMMAND]);
  });

  it("makes no model call: nothing is sent with a trigger, no message is sent", async () => {
    const instance = createFakeInstance(interruptedSession());

    await instance.runTool(CHECKPOINT_TOOL, {});
    await instance.runTool(RESUME_TOOL, { checkpointId: "m2", summary: "Meeting note" });
    await instance.fireSettled();
    await instance.runCommand("m2");

    assert.deepEqual(instance.calls.messages, [], "no custom message is sent");
    // The single user message is the command dispatch, which runs a command
    // instead of prompting the model.
    assert.deepEqual(
      instance.calls.userMessages.map((sent) => sent.options),
      [{ expandPromptTemplates: true }],
    );
  });
});

// ─── interrupt_checkpoint ────────────────────────────────────────────────────

describe(`${CHECKPOINT_TOOL}`, () => {
  it("returns the session's current leaf id as the resume point", async () => {
    const instance = createFakeInstance(interruptedSession());

    const result = await instance.runTool(CHECKPOINT_TOOL, {});

    assert.equal(result.error, undefined);
    assert.deepEqual(result.details, { checkpointId: "m4" });
    assert.match(result.text, /m4/);
    assert.deepEqual(ids(instance.session), ["m1", "m2", "m3", "m4"], "capturing writes nothing");
  });

  it("reports that an empty session has no position to record", async () => {
    const instance = createFakeInstance(interruptedSession({ leafId: null, entries: [] }));

    const result = await instance.runTool(CHECKPOINT_TOOL, {});

    assert.equal(result.error, undefined);
    assert.deepEqual(result.details, { checkpointId: null });
    assert.match(result.text, /no entries/);
  });
});

// ─── interrupt_resume: refusal ───────────────────────────────────────────────

describe(`${RESUME_TOOL} refusal`, () => {
  it("names an unknown checkpoint id and leaves the session untouched", async () => {
    const session = interruptedSession();
    const version = structuredClone(session);
    const instance = createFakeInstance(session);

    const result = await instance.runTool(RESUME_TOOL, {
      checkpointId: "missing-7",
      summary: "Slack todo",
    });

    assert.ok(result.error, "an unknown checkpoint fails");
    assert.match(result.error.message, /missing-7/);
    assert.deepEqual(session, version, "no entry, label or leaf changed");
    assert.deepEqual(instance.calls.entries, [], "nothing was written");
    assert.deepEqual(instance.calls.attempts, [], "nothing was navigated");

    // The refusal must not leave a rewind queued for the next settle.
    await instance.fireSettled();
    assert.deepEqual(instance.calls.userMessages, [], "no rewind was dispatched");
  });

  it("refuses a checkpoint the session is already on, and says why", async () => {
    const instance = createFakeInstance(interruptedSession({ leafId: "m2" }));

    const result = await instance.runTool(RESUME_TOOL, { checkpointId: "m2", summary: "Meeting note" });

    assert.ok(result.error);
    assert.match(result.error.message, /m2/);
    assert.match(result.error.message, /no interrupt turns/);
  });

  it("refuses a second rewind while one is pending", async () => {
    const instance = createFakeInstance(interruptedSession());
    await instance.runTool(RESUME_TOOL, { checkpointId: "m2", summary: "Meeting note" });

    const result = await instance.runTool(RESUME_TOOL, { checkpointId: "m1", summary: "Slack todo" });

    assert.ok(result.error);
    assert.match(result.error.message, /already scheduled/);
    assert.match(result.error.message, /m2/);
  });
});

// ─── interrupt_resume → command bridge ───────────────────────────────────────

describe(`${RESUME_TOOL} scheduling`, () => {
  it("schedules the rewind and ends the turn", async () => {
    const instance = createFakeInstance(interruptedSession());

    const result = await instance.runTool(RESUME_TOOL, { checkpointId: "m2", summary: "Meeting note" });

    assert.equal(result.error, undefined);
    assert.equal(result.terminate, true, "the rewind needs the turn to end");
    assert.deepEqual(result.details, { checkpointId: "m2", scheduled: true });
    assert.match(result.text, new RegExp(SUMMARY_LABEL));
    assert.deepEqual(instance.calls.attempts, [], "navigation waits for the turn to settle");
  });

  it("dispatches the command once, when the turn settles", async () => {
    const instance = createFakeInstance(interruptedSession());
    await instance.runTool(RESUME_TOOL, { checkpointId: "m2", summary: "Meeting note" });

    await instance.fireSettled();
    await instance.fireSettled();

    assert.deepEqual(instance.calls.userMessages, [
      { content: `/${REWIND_COMMAND} m2`, options: { expandPromptTemplates: true } },
    ]);
  });

  it("dispatches nothing when no rewind was requested", async () => {
    const instance = createFakeInstance(interruptedSession());

    await instance.fireSettled();

    assert.deepEqual(instance.calls.userMessages, []);
    assert.deepEqual(instance.calls.attempts, []);
  });
});

// ─── The rewind itself ───────────────────────────────────────────────────────

/** Schedule a rewind to `m2` and run the dispatched command, as pi would. */
async function rewindThrough(instance: FakeInstance, checkpointId = "m2"): Promise<void> {
  await instance.runTool(RESUME_TOOL, { checkpointId, summary: "A meeting note arrived" });
  await instance.fireSettled();
  await instance.runCommand(checkpointId);
}

describe(`${REWIND_COMMAND}`, () => {
  it("waits for idle, then navigates with a summary labelled interrupt", async () => {
    const instance = createFakeInstance(interruptedSession());

    await rewindThrough(instance);

    assert.deepEqual(instance.calls.order, ["waitForIdle", "navigateTree"]);
    assert.deepEqual(instance.calls.attempts, [
      {
        targetId: "m2",
        options: {
          summarize: true,
          customInstructions: summariserInstructions("A meeting note arrived"),
          label: SUMMARY_LABEL,
        },
        waited: true,
      },
    ]);
  });

  it("keeps the abandoned branch and labels the summary it leaves behind", async () => {
    const instance = createFakeInstance(interruptedSession());

    await rewindThrough(instance);

    for (const original of ["m1", "m2", "m3", "m4"]) {
      assert.ok(
        ids(instance.session).includes(original),
        `${original} must survive the rewind`,
      );
    }

    const summary = instance.session.entries.find((held) => held.type === "branch_summary");
    assert.ok(summary, "a branch summary entry is written");
    assert.deepEqual(
      instance.session.labels,
      [{ id: summary.id, label: SUMMARY_LABEL }],
      `the summary entry carries the ${SUMMARY_LABEL} label`,
    );
    assert.equal(summary.parentId, "m2", "the summary sits at the checkpoint position");
    // pi appends a label entry on top of the summary; the outcome record is
    // appended after that, so the summary stays in the live context.
    const leaf = instance.session.entries.at(-1);
    assert.equal(leaf?.type, "custom");
    const labelEntry = instance.session.entries.at(-2);
    assert.equal(labelEntry?.type, "label");
    assert.equal(labelEntry?.parentId, summary.id);
  });

  it("reports the summary entry and writes the outcome to the session", async () => {
    const instance = createFakeInstance(interruptedSession());

    await rewindThrough(instance);

    const summaryId = instance.session.entries.find((held) => held.type === "branch_summary")?.id;
    assert.deepEqual(instance.calls.entries, [
      {
        customType: REWIND_ENTRY,
        data: {
          checkpointId: "m2",
          attempts: 1,
          ok: true,
          cancelled: false,
          summaryEntryId: summaryId,
          reason: undefined,
        },
      },
    ]);
    assert.equal(instance.ui.notifications.length, 1);
    assert.equal(instance.ui.notifications[0].level, "info");
    assert.match(instance.ui.notifications[0].message, new RegExp(summaryId ?? "summary"));
    assert.match(instance.ui.notifications[0].message, /kept/);
  });

  it("waits out a session that is still streaming instead of failing", async () => {
    // Mid-turn: the session rejects navigation until the wait for idle clears it.
    // An attempt that skipped the wait would fail for both attempts.
    const instance = createFakeInstance(interruptedSession({ streaming: true }));

    await rewindThrough(instance);

    assert.deepEqual(instance.calls.attempts.map((attempt) => attempt.waited), [true]);
    assert.equal(instance.ui.notifications.at(-1)?.level, "info");
  });

  it("retries exactly once, then reports the reason and leaves the branch alone", async () => {
    const instance = createFakeInstance(interruptedSession());
    await instance.runTool(RESUME_TOOL, { checkpointId: "m2", summary: "Meeting note" });
    await instance.fireSettled();
    const entriesBefore = structuredClone(instance.session.entries);
    instance.session.behaviour = ["fail", "fail"];

    await instance.runCommand("m2");

    assert.equal(instance.calls.attempts.length, REWIND_ATTEMPTS);
    assert.deepEqual(
      instance.calls.attempts.map((attempt) => attempt.waited),
      [true, true],
      "each attempt waits for idle first",
    );
    assert.deepEqual(
      instance.session.entries.filter((held) => held.type === "branch_summary"),
      [],
      "no summary is written for a failed rewind",
    );
    assert.deepEqual(
      instance.session.entries.slice(0, entriesBefore.length),
      entriesBefore,
      "the existing entries survive a failed rewind",
    );

    const notification = instance.ui.notifications.at(-1);
    assert.equal(notification?.level, "error");
    assert.match(notification?.message ?? "", /failed after 2 attempts/);
    assert.match(notification?.message ?? "", /compaction or tree navigation/);
    assert.match(notification?.message ?? "", /unchanged/);

    const recorded = instance.calls.entries.at(-1)?.data as { ok: boolean; reason: string };
    assert.equal(recorded.ok, false, "the failure is recorded");
    assert.match(recorded.reason, /compaction or tree navigation/);
  });

  it("succeeds on the retry after one rejected attempt", async () => {
    const instance = createFakeInstance(interruptedSession());

    await instance.runTool(RESUME_TOOL, { checkpointId: "m2", summary: "Meeting note" });
    await instance.fireSettled();
    instance.session.behaviour = ["fail", "succeed"];

    await instance.runCommand("m2");

    assert.equal(instance.calls.attempts.length, REWIND_ATTEMPTS);
    const recorded = instance.calls.entries.at(-1)?.data as { ok: boolean; attempts: number };
    assert.equal(recorded.ok, true);
    assert.equal(recorded.attempts, 2);
    assert.equal(instance.ui.notifications.at(-1)?.level, "info");
  });

  it("reports a cancelled rewind without claiming the branch was summarised", async () => {
    const instance = createFakeInstance(interruptedSession());

    await instance.runTool(RESUME_TOOL, { checkpointId: "m2", summary: "Meeting note" });
    await instance.fireSettled();
    instance.session.behaviour = ["cancel"];

    await instance.runCommand("m2");

    const notification = instance.ui.notifications.at(-1);
    assert.equal(notification?.level, "warning");
    assert.match(notification?.message ?? "", /cancelled/);
    assert.match(notification?.message ?? "", /unchanged/);
    assert.doesNotMatch(notification?.message ?? "", /kept/);
    assert.deepEqual(
      instance.session.entries.filter((held) => held.type === "branch_summary"),
      [],
      "a cancelled rewind summarises nothing, so no branch_summary entry is written",
    );

    const recorded = instance.calls.entries.at(-1)?.data as { cancelled: boolean; ok: boolean };
    assert.deepEqual({ ok: recorded.ok, cancelled: recorded.cancelled }, { ok: true, cancelled: true });
  });

  it("reports that nothing is pending when invoked without a request", async () => {
    const instance = createFakeInstance(interruptedSession());

    await instance.runCommand("m2");

    assert.deepEqual(instance.calls.attempts, []);
    assert.equal(instance.ui.notifications.at(-1)?.level, "warning");
    assert.match(instance.ui.notifications.at(-1)?.message ?? "", /no interrupt rewind is pending/i);
  });

  it("drops a replaced request, so only the newest checkpoint navigates", async () => {
    const instance = createFakeInstance(interruptedSession());

    // The first request settles, but its dispatched command never runs.
    await instance.runTool(RESUME_TOOL, { checkpointId: "m2", summary: "Meeting note" });
    await instance.fireSettled();

    // A second request replaces it before either command has run.
    await instance.runTool(RESUME_TOOL, { checkpointId: "m1", summary: "Slack todo" });
    await instance.fireSettled();

    // The replaced request is gone: its command finds no handoff and navigates nothing.
    await instance.runCommand("m2");
    assert.deepEqual(
      instance.calls.attempts.map((attempt) => attempt.targetId),
      [],
      "the replaced checkpoint navigates nothing",
    );
    assert.match(
      instance.ui.notifications.at(-1)?.message ?? "",
      /no interrupt rewind is pending for m2/i,
    );
    assert.deepEqual(
      instance.session.entries.filter((held) => held.type === "branch_summary"),
      [],
      "the replaced request wrote no summary",
    );

    // The newest request still rewinds, exactly once.
    await instance.runCommand("m1");
    assert.deepEqual(
      instance.calls.attempts.map((attempt) => attempt.targetId),
      ["m1"],
      "the newest checkpoint navigates once",
    );
    assert.equal(instance.ui.notifications.at(-1)?.level, "info");
  });
});

// ─── The abandoned branch ────────────────────────────────────────────────────

describe("the session surface the extension uses", () => {
  it("is read-only apart from navigation, so nothing can be deleted", async () => {
    const instance = createFakeInstance(interruptedSession());

    await rewindThrough(instance);

    // The members the extension actually named, deduplicated. A member it starts
    // calling — a write, a delete, anything that is not navigation — lands here
    // and fails this assertion by name.
    assert.deepEqual(
      [...new Set(instance.calls.sessionManagerMembers)].sort(),
      ["getEntries", "getEntry", "getLeafId"],
      "the extension reads the session manager and never writes to it",
    );

    const removed = ["m1", "m2", "m3", "m4"].filter((id) => !ids(instance.session).includes(id));
    assert.deepEqual(removed, [], "every original entry is still in the session");
  });
});
