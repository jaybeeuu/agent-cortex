import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { formatExtensionList, parseSelection, uninstallInvocation } from "../lib/ext-prune.mjs";
import { pruneExtensions } from "../bin/installers/ext-prune.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const CLI_PATH = join(PACKAGE_ROOT, "bin", "agent-cortex.mjs");

/** Answer the prompts from a pipe and capture everything printed. */
function fakeIo(lines) {
  const chunks = [];
  const output = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { input: Readable.from(lines), output, text: () => chunks.join("") };
}

/** Run the CLI with piped stdin and an env overlay (HOME keeps tests off the real store). */
function runCli(args, { env = {}, answer = "" } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { env: { ...process.env, ...env } },
      (error, stdout, stderr) => resolve({ exitCode: error ? error.code ?? 1 : 0, stdout, stderr }),
    );
    child.stdin.end(answer);
  });
}

/** A scratch pi store holding `packages`, plus the HOME that contains it. */
async function scratchPiStore(packages) {
  const home = await mkdtemp(join(tmpdir(), "ext-prune-home-"));
  const dir = join(home, ".pi", "agent");
  await mkdir(dir, { recursive: true });
  const store = join(dir, "settings.json");
  await writeFile(store, JSON.stringify({ packages }));
  return { home, store };
}

/** A stub `pi` binary that removes its first argument from `store`, like `pi remove <source>`. */
async function makeStubPi(dir, store, { exitCode = 0 } = {}) {
  const bin = join(dir, "pi");
  await writeFile(
    bin,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs/promises');",
      `const store = ${JSON.stringify(store)};`,
      "(async () => {",
      "  const [sub, source] = process.argv.slice(2);",
      `  if (sub !== 'remove' || ${exitCode} !== 0) process.exit(${exitCode});`,
      "  const settings = JSON.parse(await fs.readFile(store, 'utf8'));",
      "  settings.packages = settings.packages.filter((p) => (typeof p === 'string' ? p : p.source) !== source);",
      "  await fs.writeFile(store, JSON.stringify(settings));",
      "})().catch(() => process.exit(1));",
      "",
    ].join("\n"),
  );
  await chmod(bin, 0o755);
  return bin;
}

/** Read the packages in a pi settings.json store. */
async function storePackages(store) {
  return JSON.parse(await readFile(store, "utf-8")).packages;
}

describe("uninstallInvocation", () => {
  it("removes a pi package through the pi CLI", async () => {
    assert.deepStrictEqual(uninstallInvocation("pi", "npm:foo"), { command: "pi", args: ["remove", "npm:foo"] });
  });

  it("uninstalls a claude plugin through the claude CLI", async () => {
    assert.deepStrictEqual(uninstallInvocation("claude", "foo@market"), {
      command: "claude",
      args: ["plugin", "uninstall", "foo@market", "-y"],
    });
  });

  it("honours binary overrides", async () => {
    assert.equal(uninstallInvocation("pi", "npm:foo", { piBin: "/opt/pi" }).command, "/opt/pi");
    assert.equal(uninstallInvocation("claude", "foo@market", { claudeBin: "/opt/claude" }).command, "/opt/claude");
  });

  it("rejects a harness without an uninstall mechanism", async () => {
    assert.throws(() => uninstallInvocation("copilot", "foo"), /no uninstall/);
  });
});

describe("formatExtensionList", () => {
  it("numbers the extensions in store order", async () => {
    assert.deepStrictEqual(formatExtensionList([{ source: "npm:a" }, { source: "npm:b" }]), [
      "1) npm:a",
      "2) npm:b",
    ]);
  });

  it("marks extensions declared in the committed manifest", async () => {
    const [row] = formatExtensionList([{ source: "npm:a", declared: true }]);
    assert.ok(row.startsWith("1) npm:a"));
    assert.match(row, /reinstall/);
  });
});

describe("parseSelection", () => {
  it("maps a 1-based number to a row index", async () => {
    assert.deepStrictEqual(parseSelection("2", 3), { index: 1 });
  });

  it("tolerates surrounding whitespace", async () => {
    assert.deepStrictEqual(parseSelection("  3  ", 3), { index: 2 });
  });

  it("quits on an empty answer, q or quit", async () => {
    for (const answer of ["", "  ", "q", "Q", "quit"]) {
      assert.deepStrictEqual(parseSelection(answer, 3), { quit: true });
    }
  });

  it("rejects a number outside the list", async () => {
    assert.deepStrictEqual(parseSelection("4", 3), { invalid: true });
    assert.deepStrictEqual(parseSelection("0", 3), { invalid: true });
  });

  it("rejects anything that is not a number or a quit", async () => {
    assert.deepStrictEqual(parseSelection("abc", 3), { invalid: true });
  });
});

describe("pruneExtensions (pi)", () => {
  it("lists the locally-installed extensions without removing anything in dry-run", async () => {
    const { home, store } = await scratchPiStore(["npm:scratch", "npm:other"]);
    try {
      const io = fakeIo([]);
      const calls = [];
      const result = await pruneExtensions({
        harness: "pi",
        piStore: store,
        dryRun: true,
        root: PACKAGE_ROOT,
        input: io.input,
        output: io.output,
        run: async (invocation) => {
          calls.push(invocation);
          return { code: 0, stdout: "" };
        },
        warn: () => {},
      });

      assert.deepStrictEqual(calls, []);
      assert.deepStrictEqual(result.entries.map((e) => e.source), ["npm:scratch", "npm:other"]);
      assert.match(io.text(), /1\) npm:scratch/);
      assert.match(io.text(), /2\) npm:other/);
      assert.match(io.text(), /dry-run/);
      assert.deepStrictEqual(await storePackages(store), ["npm:scratch", "npm:other"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("removes the selected extension through the harness CLI", async () => {
    const { home, store } = await scratchPiStore(["npm:scratch", "npm:other"]);
    try {
      const io = fakeIo(["1\n", "y\n", "q\n"]);
      const calls = [];
      const run = async ({ command, args }) => {
        calls.push({ command, args });
        const settings = JSON.parse(await readFile(store, "utf-8"));
        settings.packages = settings.packages.filter((p) => p !== args[1]);
        await writeFile(store, JSON.stringify(settings));
        return { code: 0, stdout: "" };
      };

      const result = await pruneExtensions({
        harness: "pi",
        piStore: store,
        root: PACKAGE_ROOT,
        input: io.input,
        output: io.output,
        run,
        warn: () => {},
      });

      assert.deepStrictEqual(calls, [{ command: "pi", args: ["remove", "npm:scratch"] }]);
      assert.deepStrictEqual(result.pruned, ["npm:scratch"]);
      assert.deepStrictEqual(result.failed, []);
      assert.deepStrictEqual(await storePackages(store), ["npm:other"]);
      assert.match(io.text(), /removed npm:scratch/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("keeps the extension when the confirmation is declined", async () => {
    const { home, store } = await scratchPiStore(["npm:scratch"]);
    try {
      const io = fakeIo(["1\n", "n\n", "q\n"]);
      const calls = [];
      const result = await pruneExtensions({
        harness: "pi",
        piStore: store,
        root: PACKAGE_ROOT,
        input: io.input,
        output: io.output,
        run: async (invocation) => {
          calls.push(invocation);
          return { code: 0, stdout: "" };
        },
        warn: () => {},
      });

      assert.deepStrictEqual(calls, []);
      assert.deepStrictEqual(result.pruned, []);
      assert.deepStrictEqual(await storePackages(store), ["npm:scratch"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports a failed removal and leaves the store untouched", async () => {
    const { home, store } = await scratchPiStore(["npm:scratch"]);
    try {
      const io = fakeIo(["1\n", "y\n", "q\n"]);
      const result = await pruneExtensions({
        harness: "pi",
        piStore: store,
        root: PACKAGE_ROOT,
        input: io.input,
        output: io.output,
        run: async () => ({ code: 1, stdout: "" }),
        warn: () => {},
      });

      assert.deepStrictEqual(result.pruned, []);
      assert.deepStrictEqual(result.failed, ["npm:scratch"]);
      assert.deepStrictEqual(await storePackages(store), ["npm:scratch"]);
      assert.match(io.text(), /npm:scratch/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports an empty store and exits without prompting", async () => {
    const { home, store } = await scratchPiStore([]);
    try {
      const io = fakeIo([]);
      const result = await pruneExtensions({
        harness: "pi",
        piStore: store,
        root: PACKAGE_ROOT,
        input: io.input,
        output: io.output,
        run: async () => ({ code: 0, stdout: "" }),
        warn: () => {},
      });

      assert.deepStrictEqual(result.entries, []);
      assert.match(io.text(), /none/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("ends cleanly when the input ends before a selection", async () => {
    const { home, store } = await scratchPiStore(["npm:scratch"]);
    try {
      const io = fakeIo([]);
      const result = await pruneExtensions({
        harness: "pi",
        piStore: store,
        root: PACKAGE_ROOT,
        input: io.input,
        output: io.output,
        run: async () => ({ code: 0, stdout: "" }),
        warn: () => {},
      });

      assert.deepStrictEqual(result.pruned, []);
      assert.equal(result.cancelled, true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("re-prompts after an unparseable answer", async () => {
    const { home, store } = await scratchPiStore(["npm:scratch"]);
    try {
      const io = fakeIo(["oops\n", "9\n", "1\n", "y\n", "q\n"]);
      const calls = [];
      const result = await pruneExtensions({
        harness: "pi",
        piStore: store,
        root: PACKAGE_ROOT,
        input: io.input,
        output: io.output,
        run: async (invocation) => {
          calls.push(invocation);
          return { code: 0, stdout: "" };
        },
        warn: () => {},
      });

      assert.deepStrictEqual(calls, [{ command: "pi", args: ["remove", "npm:scratch"] }]);
      assert.deepStrictEqual(result.pruned, ["npm:scratch"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("offers the remaining extensions again after a removal", async () => {
    const { home, store } = await scratchPiStore(["npm:a", "npm:b"]);
    try {
      const io = fakeIo(["1\n", "y\n", "1\n", "y\n"]);
      const result = await pruneExtensions({
        harness: "pi",
        piStore: store,
        root: PACKAGE_ROOT,
        input: io.input,
        output: io.output,
        run: async ({ args }) => {
          const settings = JSON.parse(await readFile(store, "utf-8"));
          settings.packages = settings.packages.filter((p) => p !== args[1]);
          await writeFile(store, JSON.stringify(settings));
          return { code: 0, stdout: "" };
        },
        warn: () => {},
      });

      assert.deepStrictEqual(result.pruned, ["npm:a", "npm:b"]);
      assert.deepStrictEqual(await storePackages(store), []);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("never writes the committed manifest", async () => {
    const { home, store } = await scratchPiStore(["npm:scratch"]);
    try {
      const root = join(home, "pkg");
      await mkdir(root, { recursive: true });
      const manifestPath = join(root, "pi.extensions.json");
      const manifest = JSON.stringify({ harness: "pi", extensions: ["npm:scratch"] });
      await writeFile(manifestPath, manifest);

      const io = fakeIo(["1\n", "y\n", "q\n"]);
      const result = await pruneExtensions({
        harness: "pi",
        manifestPath,
        piStore: store,
        input: io.input,
        output: io.output,
        run: async () => ({ code: 0, stdout: "" }),
        warn: () => {},
      });

      assert.deepStrictEqual(result.entries, [{ source: "npm:scratch", declared: true }]);
      assert.equal(await readFile(manifestPath, "utf-8"), manifest);
      assert.match(io.text(), /reinstall/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("pruneExtensions (claude)", () => {
  it("lists the installed plugins and uninstalls the chosen one", async () => {
    const io = fakeIo(["1\n", "y\n", "q\n"]);
    const calls = [];
    const run = async ({ command, args, capture }) => {
      calls.push({ command, args });
      if (capture) return { code: 0, stdout: JSON.stringify([{ id: "foo@market" }, { id: "bar@market" }]) };
      return { code: 0, stdout: "" };
    };

    const result = await pruneExtensions({
      harness: "claude",
      root: PACKAGE_ROOT,
      input: io.input,
      output: io.output,
      run,
      warn: () => {},
    });

    assert.deepStrictEqual(calls, [
      { command: "claude", args: ["plugin", "list", "--json"] },
      { command: "claude", args: ["plugin", "uninstall", "foo@market", "-y"] },
    ]);
    assert.deepStrictEqual(result.pruned, ["foo@market"]);
    assert.match(io.text(), /1\) foo@market/);
  });
});

describe("CLI ext prune", () => {
  it("lists installed extensions and exits cleanly on dry-run", async () => {
    const { home, store } = await scratchPiStore(["npm:scratch"]);
    try {
      const { exitCode, stdout, stderr } = await runCli(["ext", "prune", "--harness", "pi", "--dry-run"], {
        env: { HOME: home },
      });

      assert.equal(stderr, "");
      assert.equal(exitCode, 0);
      assert.match(stdout, /Locally-installed "pi" extensions/);
      assert.match(stdout, /1\) npm:scratch/);
      assert.match(stdout, /dry-run — nothing removed/);
      assert.deepStrictEqual(await storePackages(store), ["npm:scratch"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("prunes a scratch extension locally and leaves the committed manifest alone", async () => {
    const { home, store } = await scratchPiStore(["npm:scratch"]);
    try {
      const binDir = await mkdtemp(join(tmpdir(), "ext-prune-bin-"));
      await makeStubPi(binDir, store);
      const manifestPath = join(PACKAGE_ROOT, "pi.extensions.json");
      const manifestBefore = await readFile(manifestPath, "utf-8");

      const { exitCode, stdout } = await runCli(["ext", "prune", "--harness", "pi"], {
        env: { HOME: home, PATH: `${binDir}:${process.env.PATH}` },
        answer: "1\ny\nq\n",
      });

      assert.equal(exitCode, 0);
      assert.match(stdout, /removed npm:scratch/);
      assert.deepStrictEqual(await storePackages(store), []);
      assert.equal(await readFile(manifestPath, "utf-8"), manifestBefore);

      await rm(binDir, { recursive: true, force: true });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("exits 1 when the harness refuses to uninstall", async () => {
    const { home, store } = await scratchPiStore(["npm:scratch"]);
    try {
      const binDir = await mkdtemp(join(tmpdir(), "ext-prune-bin-"));
      await makeStubPi(binDir, store, { exitCode: 1 });

      const { exitCode, stdout } = await runCli(["ext", "prune", "--harness", "pi"], {
        env: { HOME: home, PATH: `${binDir}:${process.env.PATH}` },
        answer: "1\ny\nq\n",
      });

      assert.equal(exitCode, 1);
      assert.match(stdout, /npm:scratch/);
      assert.deepStrictEqual(await storePackages(store), ["npm:scratch"]);

      await rm(binDir, { recursive: true, force: true });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("defaults to the pi harness", async () => {
    const { home } = await scratchPiStore(["npm:scratch"]);
    try {
      const { exitCode, stdout } = await runCli(["ext", "prune", "--dry-run"], { env: { HOME: home } });
      assert.equal(exitCode, 0);
      assert.match(stdout, /"pi" extensions/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("exits 1 for an unsupported harness", async () => {
    const { exitCode, stderr } = await runCli(["ext", "prune", "--harness", "copilot"]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /Unknown harness "copilot"/);
  });
});
