import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import sessionStartExtension from "./index.ts";

// ─── Harness ─────────────────────────────────────────────────────────────────

interface InjectedMessage {
  customType: string;
  content: string;
  display: boolean;
}

/** A handler recorded from `pi.on`, invoked via Reflect.apply so its exact
 *  overload signature does not leak into the fake. */
type RecordedHandler = (...args: never[]) => unknown;

interface FakePi {
  pi: ExtensionAPI;
  /** Simulate pi dispatching `before_agent_start` and return the injected message. */
  start(cwd: string): Promise<InjectedMessage | undefined>;
}

function createFakePi(): FakePi {
  const handlers = new Map<string, RecordedHandler[]>();

  const pi: ExtensionAPI = {
    on: (event: string, handler: RecordedHandler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    async start(cwd) {
      const handler = handlers.get("before_agent_start")?.[0];
      assert.ok(handler, "session-start should register a before_agent_start handler");
      const run = handler as unknown as (
        event: unknown,
        ctx: { cwd: string },
      ) => Promise<{ message?: InjectedMessage } | undefined>;
      const result = await run({}, { cwd });
      return result?.message;
    },
  };
}

/** Run one simulated session start against `cwd` and return the injected text. */
async function inject(cwd: string): Promise<string | undefined> {
  const fake = createFakePi();
  sessionStartExtension(fake.pi);
  const message = await fake.start(cwd);
  return message?.content;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const AGENTS_MD = "# AGENTS\n\nProject instructions live here.";
const PREFERENCES_MD = "# User Preferences\n\nPrefer pnpm over npm.";

describe("session-start injection", () => {
  let emptyProject: string;
  let fullProject: string;

  before(() => {
    emptyProject = mkdtempSync(join(tmpdir(), "session-start-empty-"));
    fullProject = mkdtempSync(join(tmpdir(), "session-start-full-"));
    writeFileSync(join(fullProject, "AGENTS.md"), AGENTS_MD, "utf-8");
    mkdirSync(join(fullProject, "docs"), { recursive: true });
    writeFileSync(join(fullProject, "docs", "user-preferences.md"), PREFERENCES_MD, "utf-8");
  });

  after(() => {
    rmSync(emptyProject, { recursive: true, force: true });
    rmSync(fullProject, { recursive: true, force: true });
  });

  it("injects AGENTS.md and docs/user-preferences.md content", async () => {
    const content = await inject(fullProject);
    assert.ok(content, "expected the context files to be injected");
    assert.match(content, /--- AGENTS\.md ---/);
    assert.match(content, /Project instructions live here\./);
    assert.match(content, /--- user-preferences\.md ---/);
    assert.match(content, /Prefer pnpm over npm\./);
  });

  it("marks the injected message as a hidden session-start message", async () => {
    const fake = createFakePi();
    sessionStartExtension(fake.pi);
    const message = await fake.start(fullProject);

    assert.ok(message);
    assert.equal(message.customType, "session-start");
    assert.equal(message.display, false);
  });

  it("injects nothing for a project without context files", async () => {
    const content = await inject(emptyProject);
    assert.equal(content, undefined, "no context files means no injected message");
  });

  it("never advertises skills with pi-unresolvable /skill: syntax", async () => {
    const content = await inject(fullProject);
    assert.ok(content);
    assert.ok(!content.includes("/skill:"), "pi has no /skill: resolver — drop the hint blurb");
  });

  it("never enumerates a fixed subset of skill names", async () => {
    // pi's system prompt already lists every discovered skill with its SKILL.md
    // path; a hand-maintained subset here drifts from skills/ silently.
    const content = (await inject(fullProject)) ?? "";
    for (const skill of ["using-agent-skills", "bd-tool", "git-workflow"]) {
      assert.ok(!content.includes(skill), `${skill} should not be hardcoded in session-start`);
    }
  });
});
