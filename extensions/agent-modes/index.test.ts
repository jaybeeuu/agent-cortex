import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type AgentDef, discoverAgents } from "./discover.ts";
import agentModesExtension, { registerAgentFlag } from "./index.ts";

const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "agents");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function agent(id: string): AgentDef {
  return {
    id,
    name: `agent-cortex:${id}`,
    description: `${id} agent`,
    color: "accent",
    tools: [],
    prompt: "",
  };
}

type RegisterFlagArgs = Parameters<ExtensionAPI["registerFlag"]>;
/** A handler recorded from `pi.on`, invoked via Reflect.apply so its exact
 *  overload signature does not leak into the fake. */
type RecordedHandler = (...args: never[]) => unknown;

interface FakeContext {
  ui: {
    statuses: Array<{ id: string; text: string | undefined }>;
    notifications: Array<{ message: string; level: string }>;
    setStatus(id: string, text: string | undefined): void;
    notify(message: string, level: string): void;
    theme: { fg(color: string, text: string): string };
  };
  sessionManager: { getEntries(): unknown[] };
}

interface FakePi {
  pi: ExtensionAPI;
  flags: RegisterFlagArgs[];
  handlers: Map<string, RecordedHandler[]>;
  setActiveToolsCalls: string[][];
  /** Simulate pi dispatching an event to the handlers registered for it. */
  fire(event: string, ...args: unknown[]): void;
}

/**
 * Build a full ExtensionAPI test double that records the calls agent-modes
 * makes. `getFlag` resolves against `flagValues`, and `getActiveTools` returns
 * a fixed baseline so setActiveTools calls are observable.
 */
function createFakePi(flagValues: Record<string, boolean | string> = {}): FakePi {
  const flags: RegisterFlagArgs[] = [];
  const handlers = new Map<string, RecordedHandler[]>();
  const setActiveToolsCalls: string[][] = [];
  const values = new Map<string, boolean | string>(Object.entries(flagValues));
  const baselineTools = ["read", "bash"];

  const pi: ExtensionAPI = {
    on: (event: string, handler: RecordedHandler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerFlag: (name, options) => {
      flags.push([name, options]);
    },
    getFlag: (name) => values.get(name),
    getActiveTools: () => [...baselineTools],
    setActiveTools: (toolNames) => {
      setActiveToolsCalls.push(toolNames);
    },
    registerCommand: () => {},
    registerShortcut: () => {},
    registerTool: () => {},
    registerMessageRenderer: () => {},
    registerProvider: () => {},
    unregisterProvider: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    appendEntry: () => {},
    setSessionName: () => {},
    getSessionName: () => undefined,
    setLabel: () => {},
    exec: async () => {
      throw new Error("not implemented");
    },
    getAllTools: () => [],
    getCommands: () => [],
    setModel: async () => false,
    getThinkingLevel: () => "off",
    setThinkingLevel: () => {},
    events: { on: () => () => {}, emit: () => {} },
  };

  return {
    pi,
    flags,
    handlers,
    setActiveToolsCalls,
    fire(event, ...args) {
      for (const handler of handlers.get(event) ?? []) {
        Reflect.apply(handler, undefined, args);
      }
    },
  };
}

function createFakeContext(): FakeContext {
  return {
    ui: {
      statuses: [],
      notifications: [],
      setStatus(id, text) {
        this.statuses.push({ id, text });
      },
      notify(message, level) {
        this.notifications.push({ message, level });
      },
      theme: { fg: (_color, text) => text },
    },
    sessionManager: { getEntries: () => [] },
  };
}

// ─── registerAgentFlag ───────────────────────────────────────────────────────

describe("registerAgentFlag", () => {
  it("registers --agent as a string flag listing the discovered agent ids", () => {
    const calls: RegisterFlagArgs[] = [];
    const pi: Pick<ExtensionAPI, "registerFlag"> = {
      registerFlag: (...args) => calls.push(args),
    };

    registerAgentFlag(pi, [
      agent("ralph"),
      agent("ralph-plan"),
      agent("plan"),
      agent("strategy"),
    ]);

    assert.equal(calls.length, 1);
    const [name, options] = calls[0];
    assert.equal(name, "agent");
    assert.equal(options.type, "string");
    assert.equal(
      options.description,
      "Start in a specific agent mode (ralph, ralph-plan, plan, strategy)",
    );
  });
});

// ─── Registration timing ─────────────────────────────────────────────────────

describe("agentModesExtension flag registration", () => {
  it("registers --agent during load, before any session event fires", () => {
    const fake = createFakePi();

    agentModesExtension(fake.pi);

    // The flag must exist straight after the factory returns: pi validates CLI
    // flags against extensions loaded at startup, so registering it from the
    // session_start handler would be too late and `pi --agent <name>` would fail.
    assert.equal(fake.flags.length, 1);
    const [name, options] = fake.flags[0];
    assert.equal(name, "agent");
    assert.equal(options.type, "string");
    assert.match(options.description ?? "", /^Start in a specific agent mode \(/);
  });
});

// ─── --agent flag contract ───────────────────────────────────────────────────

describe("agentModesExtension --agent flag", () => {
  it("activates the named agent on session start", () => {
    const fake = createFakePi({ agent: "plan" });
    const ctx = createFakeContext();

    agentModesExtension(fake.pi);
    fake.fire("session_start", {}, ctx);

    const plan = discoverAgents(AGENTS_DIR).find((a) => a.id === "plan");
    assert.ok(plan, "the plan agent should be discoverable");
    assert.deepEqual(fake.setActiveToolsCalls.at(-1), plan.tools);
    assert.ok(
      ctx.ui.statuses.some((s) => s.id === "agent-mode" && s.text?.includes("plan")),
      "the status indicator should show the active agent",
    );
  });

  it("falls back to default mode for an unknown agent and leaves tools untouched", () => {
    const fake = createFakePi({ agent: "does-not-exist" });
    const ctx = createFakeContext();

    agentModesExtension(fake.pi);
    fake.fire("session_start", {}, ctx);

    // Unknown flag → default mode: baseline tools restored, no agent status.
    assert.deepEqual(fake.setActiveToolsCalls.at(-1), ["read", "bash"]);
    assert.ok(
      ctx.ui.statuses.every((s) => !s.text?.includes("agent:")),
      "no agent mode should be reported",
    );
  });
});
