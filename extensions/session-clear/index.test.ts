import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { createTempRoot } from "../../test/helpers/temp-root.mjs";
import sessionClearExtension, { PROVENANCE_ENTRY } from "./index.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

type SessionModel = NonNullable<ExtensionContext["model"]>;
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

const tempRoot = createTempRoot("session-clear-");

/** A handler recorded from `pi.on` or `pi.registerCommand`, invoked via
 *  Reflect.apply so its exact signature does not leak into the fake. */
type RecordedHandler = (...args: never[]) => unknown;

/** The state a live PI session exposes to an extension. */
interface FakeSession {
  sessionFile: string | undefined;
  name: string | undefined;
  model: SessionModel | undefined;
  thinkingLevel: ThinkingLevel;
}

interface FakeUi {
  notifications: Array<{ message: string; level: string | undefined }>;
  /** Dialog-capable UI members the command must never reach. */
  prompts: string[];
  notify(message: string, level?: string): void;
  select(title: string): Promise<undefined>;
  confirm(title: string): Promise<boolean>;
  editor(title: string): Promise<undefined>;
}

interface FakeContext {
  ui: FakeUi;
  cwd: string;
  readonly model: SessionModel | undefined;
  sessionManager: { getSessionFile(): string | undefined };
  newSession(options?: { parentSession?: string }): Promise<{ cancelled: boolean }>;
}

interface Calls {
  commands: Array<{ name: string; description: string | undefined }>;
  sessionNames: string[];
  models: SessionModel[];
  thinkingLevels: ThinkingLevel[];
  entries: Array<{ customType: string; data: unknown }>;
  /** Anything sent to the model. `/clear` must send none. */
  sent: unknown[];
  newSessionOptions: Array<{ parentSession?: string }>;
}

interface FakeInstance {
  pi: ExtensionAPI;
  session: FakeSession;
  calls: Calls;
  /** Reproduce pi's teardown: every action method throws once the session is gone. */
  invalidate(): void;
  context(overrides?: Partial<Pick<FakeContext, "newSession">>): FakeContext;
  runCommand(ctx: FakeContext): Promise<void>;
  fireSessionStart(event: FakeSessionStart, ctx: FakeContext): Promise<void>;
}

interface FakeSessionStart {
  type: "session_start";
  reason: "startup" | "reload" | "new" | "resume" | "fork";
  previousSessionFile?: string;
}

function sessionModel(provider: string, id: string): SessionModel {
  return {
    id,
    name: id,
    api: "anthropic-messages",
    provider,
    baseUrl: "https://pi.test",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 200_000,
    maxTokens: 8_000,
  };
}

/**
 * Build a full `ExtensionAPI` test double for one extension instance.
 *
 * The literal is complete so `tsc` fails when a pi release grows the interface,
 * and every action method throws after `invalidate()` exactly as pi's own
 * `assertActive()` does, so a use of a stale `pi` fails the test.
 */
function createFakeInstance(session: FakeSession): FakeInstance {
  const calls: Calls = {
    commands: [],
    sessionNames: [],
    models: [],
    thinkingLevels: [],
    entries: [],
    sent: [],
    newSessionOptions: [],
  };

  const state: FakeSession = { ...session };
  const handlers = new Map<string, RecordedHandler[]>();
  let commandHandler: RecordedHandler | undefined;
  let stale = false;

  const assertLive = (): void => {
    if (stale) throw new Error("This extension ctx is stale after session replacement");
  };

  const pi: ExtensionAPI = {
    on: (event: string, handler: RecordedHandler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
    registerFlag: () => {},
    getFlag: () => {
      assertLive();
      return undefined;
    },
    getActiveTools: () => {
      assertLive();
      return [];
    },
    setActiveTools: () => {
      assertLive();
    },
    registerCommand: (name, options) => {
      assertLive();
      calls.commands.push({ name, description: options.description });
      commandHandler = options.handler;
    },
    registerShortcut: () => {},
    registerTool: () => {},
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
      assertLive();
      calls.sent.push(message);
    },
    sendUserMessage: (content) => {
      assertLive();
      calls.sent.push(content);
    },
    appendEntry: (customType, data) => {
      assertLive();
      calls.entries.push({ customType, data });
    },
    setSessionName: (name) => {
      assertLive();
      state.name = name;
      calls.sessionNames.push(name);
    },
    getSessionName: () => {
      assertLive();
      return state.name;
    },
    setLabel: () => {
      assertLive();
    },
    exec: async () => {
      throw new Error("not implemented");
    },
    getAllTools: () => [],
    getSettings: () => {
      throw new Error("not implemented");
    },
    getCommands: () => [],
    setModel: async (model) => {
      assertLive();
      state.model = model;
      calls.models.push(model);
      return true;
    },
    getThinkingLevel: () => {
      assertLive();
      return state.thinkingLevel;
    },
    setThinkingLevel: (level) => {
      assertLive();
      state.thinkingLevel = level;
      calls.thinkingLevels.push(level);
    },
    events: { on: () => () => {}, emit: () => {} },
  };

  const ui: FakeUi = {
    notifications: [],
    prompts: [],
    notify(message, level) {
      this.notifications.push({ message, level });
    },
    async select(title) {
      this.prompts.push(title);
      return undefined;
    },
    async confirm(title) {
      this.prompts.push(title);
      return true;
    },
    async editor(title) {
      this.prompts.push(title);
      return undefined;
    },
  };

  return {
    pi,
    session: state,
    calls,
    invalidate() {
      stale = true;
    },
    context(overrides = {}) {
      const ctx: FakeContext = {
        ui,
        cwd: "/workspace",
        get model() {
          return state.model;
        },
        sessionManager: { getSessionFile: () => state.sessionFile },
        newSession: async (options) => {
          calls.newSessionOptions.push(options ?? {});
          return { cancelled: false };
        },
        ...overrides,
      };
      return ctx;
    },
    async runCommand(ctx) {
      assert.ok(commandHandler, "the extension must register /clear while loading");
      await Reflect.apply(commandHandler, undefined, ["", ctx]);
    },
    async fireSessionStart(event, ctx) {
      for (const handler of handlers.get("session_start") ?? []) {
        await Reflect.apply(handler, undefined, [event, ctx]);
      }
    },
  };
}

/**
 * Drive `/clear` the way pi does: the handler asks for a replacement, pi tears
 * the old session down, loads a fresh extension instance, and starts the new
 * session before returning. Returns the replacement instance, if one was made.
 */
async function runClear(
  old: FakeInstance,
  replacement: FakeSession,
  options: { cancel?: boolean } = {},
): Promise<FakeInstance | undefined> {
  const previousSessionFile = old.session.sessionFile;
  let created: FakeInstance | undefined;

  const ctx = old.context({
    newSession: async (newSessionOptions) => {
      old.calls.newSessionOptions.push(newSessionOptions ?? {});
      if (options.cancel === true) return { cancelled: true };

      old.invalidate();
      created = createFakeInstance(replacement);
      sessionClearExtension(created.pi);
      await created.fireSessionStart(
        { type: "session_start", reason: "new", previousSessionFile },
        created.context(),
      );
      return { cancelled: false };
    },
  });

  await old.runCommand(ctx);
  return created;
}

const OLD_MODEL = sessionModel("anthropic", "claude-sonnet-4-5");
const OTHER_MODEL = sessionModel("anthropic", "claude-haiku-4-5");

function oldSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    sessionFile: "/sessions/old.jsonl",
    name: "Refactor auth module",
    model: OLD_MODEL,
    thinkingLevel: "high",
    ...overrides,
  };
}

function replacementSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    sessionFile: "/sessions/new.jsonl",
    name: undefined,
    model: OLD_MODEL,
    thinkingLevel: "high",
    ...overrides,
  };
}

// ─── Registration ────────────────────────────────────────────────────────────

describe("sessionClearExtension", () => {
  it("registers /clear from the factory, before any session event fires", () => {
    const instance = createFakeInstance(oldSession());

    sessionClearExtension(instance.pi);

    assert.deepEqual(
      instance.calls.commands.map((command) => command.name),
      ["clear"],
    );
    assert.equal(
      instance.calls.commands[0].description,
      "Clear the context, keeping the session name, model and thinking level",
    );
  });

  it("registers the command from the factory only, not from session_start", async () => {
    const instance = createFakeInstance(oldSession());
    sessionClearExtension(instance.pi);

    await instance.fireSessionStart(
      { type: "session_start", reason: "startup" },
      instance.context(),
    );

    assert.equal(instance.calls.commands.length, 1);
  });
});

// ─── Replacement ─────────────────────────────────────────────────────────────

describe("/clear replacement", () => {
  it("links the cleared session as the replacement's parent", async () => {
    const old = createFakeInstance(oldSession());
    sessionClearExtension(old.pi);

    await runClear(old, replacementSession());

    assert.deepEqual(old.calls.newSessionOptions, [{ parentSession: "/sessions/old.jsonl" }]);
  });

  it("keeps the old session file on disk", async () => {
    const workspace = await tempRoot.createWorkspace();
    const sessionFile = join(workspace, "old.jsonl");
    await writeFile(sessionFile, '{"type":"session"}\n', "utf-8");

    const old = createFakeInstance(oldSession({ sessionFile }));
    sessionClearExtension(old.pi);

    await runClear(old, replacementSession({ sessionFile: join(workspace, "new.jsonl") }));

    assert.equal(await readFile(sessionFile, "utf-8"), '{"type":"session"}\n');
  });

  it("reports the clear without prompting or sending a model message", async () => {
    const old = createFakeInstance(oldSession());
    sessionClearExtension(old.pi);
    const ctx = old.context();

    await runClear(old, replacementSession());

    assert.deepEqual(ctx.ui.prompts, [], "no confirmation, summary, or selection may be shown");
    assert.deepEqual(old.calls.sent, [], "nothing may be sent to the model");
    assert.deepEqual(ctx.ui.notifications, [], "the old instance must not report the clear");
  });
});

// ─── Identity carry-over ─────────────────────────────────────────────────────

describe("/clear identity", () => {
  it("re-applies the session name even when the replacement already carries it", async () => {
    const old = createFakeInstance(oldSession({ name: "Refactor auth module" }));
    sessionClearExtension(old.pi);

    const replacement = await runClear(
      old,
      replacementSession({ name: "Refactor auth module" }),
    );

    assert.deepEqual(replacement?.calls.sessionNames, ["Refactor auth module"]);
  });

  it("restores the model when the replacement fell back to a different one", async () => {
    const old = createFakeInstance(oldSession({ model: OLD_MODEL }));
    sessionClearExtension(old.pi);

    const replacement = await runClear(old, replacementSession({ model: OTHER_MODEL }));

    assert.deepEqual(replacement?.calls.models, [OLD_MODEL]);
  });

  it("leaves the model alone when the replacement already uses it", async () => {
    const old = createFakeInstance(oldSession({ model: OLD_MODEL }));
    sessionClearExtension(old.pi);

    const replacement = await runClear(old, replacementSession({ model: OLD_MODEL }));

    assert.deepEqual(replacement?.calls.models, []);
  });

  it("restores the thinking level when the replacement fell back to a different one", async () => {
    const old = createFakeInstance(oldSession({ thinkingLevel: "high" }));
    sessionClearExtension(old.pi);

    const replacement = await runClear(
      old,
      replacementSession({ thinkingLevel: "low" }),
    );

    assert.deepEqual(replacement?.calls.thinkingLevels, ["high"]);
  });

  it("leaves the thinking level alone when the replacement already uses it", async () => {
    const old = createFakeInstance(oldSession({ thinkingLevel: "high" }));
    sessionClearExtension(old.pi);

    const replacement = await runClear(
      old,
      replacementSession({ thinkingLevel: "high" }),
    );

    assert.deepEqual(replacement?.calls.thinkingLevels, []);
  });

  it("records the cleared session as a non-model provenance entry and reports it", async () => {
    const old = createFakeInstance(oldSession({ sessionFile: "/sessions/old.jsonl" }));
    sessionClearExtension(old.pi);

    const replacement = await runClear(old, replacementSession());

    assert.equal(replacement?.calls.entries.length, 1);
    const [entry] = replacement?.calls.entries ?? [];
    assert.equal(entry.customType, PROVENANCE_ENTRY);
    const data = entry.data as { clearedFrom?: string; at?: string };
    assert.equal(data.clearedFrom, "/sessions/old.jsonl");
    assert.ok(
      typeof data.at === "string" && !Number.isNaN(Date.parse(data.at)),
      "the entry should record when the clear happened",
    );
    assert.deepEqual(replacement?.calls.sent, []);
    const ctx = replacement?.context();
    assert.match(
      ctx?.ui.notifications[0]?.message ?? "",
      /\/sessions\/old\.jsonl/,
      "the report should name the cleared session",
    );
  });

  it("applies the identity once, so later session starts are untouched", async () => {
    const old = createFakeInstance(oldSession());
    sessionClearExtension(old.pi);

    const replacement = await runClear(old, replacementSession());
    assert.ok(replacement);
    await replacement.fireSessionStart(
      {
        type: "session_start",
        reason: "new",
        previousSessionFile: "/sessions/old.jsonl",
      },
      replacement.context(),
    );

    assert.deepEqual(replacement.calls.sessionNames, ["Refactor auth module"]);
    assert.equal(replacement.calls.entries.length, 1);
  });

  it("drops the identity when the replacement is cancelled", async () => {
    const old = createFakeInstance(oldSession());
    sessionClearExtension(old.pi);

    const replacement = await runClear(old, replacementSession(), { cancel: true });
    assert.equal(replacement, undefined);

    // A later, unrelated session start must not pick up the abandoned identity.
    const unrelated = createFakeInstance(replacementSession());
    sessionClearExtension(unrelated.pi);
    await unrelated.fireSessionStart(
      {
        type: "session_start",
        reason: "new",
        previousSessionFile: "/sessions/old.jsonl",
      },
      unrelated.context(),
    );

    assert.deepEqual(unrelated.calls.sessionNames, []);
    assert.deepEqual(unrelated.calls.entries, []);
  });

  it("ignores an identity on a session start that is not a replacement", async () => {
    const old = createFakeInstance(oldSession());
    sessionClearExtension(old.pi);
    await runClear(old, replacementSession());

    const startup = createFakeInstance(oldSession({ sessionFile: undefined }));
    sessionClearExtension(startup.pi);
    await startup.fireSessionStart(
      { type: "session_start", reason: "startup" },
      startup.context(),
    );

    assert.deepEqual(startup.calls.sessionNames, []);
  });
});
