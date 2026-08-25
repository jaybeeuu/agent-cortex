import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { waitForAgents, type BackgroundEntry } from "./wait.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
}

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

/**
 * A background-run ledger matching the extension's `backgroundRuns` map:
 * each entry holds a result (null while running) and a promise that resolves
 * when the run finishes. `finish` mirrors the real run path — result is set
 * before the promise settles.
 */
function makeLedger() {
	const entries = new Map<string, { entry: BackgroundEntry<string>; done: Deferred }>();

	const spawn: () => string = () => {
		const agentId = `agent-${entries.size + 1}`;
		const done = deferred();
		const entry: BackgroundEntry<string> = {
			result: null,
			promise: done.promise,
		};
		entries.set(agentId, { entry, done });
		return agentId;
	};

	const finish = async (agentId: string, result: string): Promise<void> => {
		const run = entries.get(agentId);
		if (!run) throw new Error(`no run for ${agentId}`);
		// Match production ordering: result committed before the promise settles.
		run.entry.result = result;
		run.done.resolve();
		await delay(0);
	};

	const finishLater = (agentId: string, result: string, ms: number): void => {
		const run = entries.get(agentId);
		if (!run) throw new Error(`no run for ${agentId}`);
		void delay(ms).then(() => finish(agentId, result));
	};

	const get = (agentId: string): BackgroundEntry<string> | undefined => entries.get(agentId)?.entry;

	return { spawn, finish, finishLater, get };
}

// ─── waitForAgents ────────────────────────────────────────────────────────────

describe("waitForAgents", () => {
	it("returns immediately with the result when an agent already completed", async () => {
		const ledger = makeLedger();
		const agentId = ledger.spawn();
		ledger.finishLater(agentId, "done", 1);
		await delay(15);

		const outcome = await waitForAgents(ledger.get, [agentId], { timeoutMs: 1000 });
		assert.deepEqual(outcome.completed, [{ agentId, result: "done" }]);
		assert.deepEqual(outcome.running, []);
		assert.deepEqual(outcome.notFound, []);
		assert.equal(outcome.timedOut, false);
		assert.equal(outcome.aborted, false);
	});

	it("returns immediately when an agent id has no tracked run", async () => {
		const ledger = makeLedger();
		const runningId = ledger.spawn();

		const outcome = await waitForAgents(ledger.get, [runningId, "agent-unknown"], { timeoutMs: 1000 });
		assert.deepEqual(outcome.notFound, ["agent-unknown"]);
		assert.deepEqual(outcome.running, [runningId]);
		assert.deepEqual(outcome.completed, []);
		assert.equal(outcome.timedOut, false);
	});

	it("returns the first completion while slower agents stay running", async () => {
		const ledger = makeLedger();
		const fastId = ledger.spawn();
		const slowId = ledger.spawn();
		ledger.finishLater(fastId, "fast result", 10);

		const outcome = await waitForAgents(ledger.get, [fastId, slowId], { timeoutMs: 1000 });
		assert.deepEqual(outcome.completed, [{ agentId: fastId, result: "fast result" }]);
		assert.deepEqual(outcome.running, [slowId]);
		assert.equal(outcome.timedOut, false);
	});

	it("returns the agent that finished first when completions stagger", async () => {
		const ledger = makeLedger();
		const a = ledger.spawn();
		const b = ledger.spawn();
		ledger.finishLater(b, "bee", 10);
		ledger.finishLater(a, "aye", 40);

		const outcome = await waitForAgents(ledger.get, [a, b], { timeoutMs: 1000 });
		assert.deepEqual(
			outcome.completed.map((c) => ({ id: c.agentId, result: c.result })),
			[{ id: b, result: "bee" }],
		);
		assert.deepEqual(outcome.running, [a]);
	});

	it("preserves request order when several agents already completed", async () => {
		const ledger = makeLedger();
		const a = ledger.spawn();
		const b = ledger.spawn();
		await ledger.finish(a, "aye");
		await ledger.finish(b, "bee");

		const outcome = await waitForAgents(ledger.get, [a, b], { timeoutMs: 1000 });
		assert.deepEqual(
			outcome.completed.map((c) => ({ id: c.agentId, result: c.result })),
			[
				{ id: a, result: "aye" },
				{ id: b, result: "bee" },
			],
		);
		assert.deepEqual(outcome.running, []);
	});

	it("marks still-running agents STILL RUNNING when the timeout elapses with no completion", async () => {
		const ledger = makeLedger();
		const agentId = ledger.spawn(); // never finishes

		const outcome = await waitForAgents(ledger.get, [agentId], { timeoutMs: 30 });
		assert.deepEqual(outcome.completed, []);
		assert.deepEqual(outcome.running, [agentId]);
		assert.equal(outcome.timedOut, true);
		assert.equal(outcome.aborted, false);
	});

	it("can wait again on the same still-running id and pick up its later result", async () => {
		const ledger = makeLedger();
		const agentId = ledger.spawn();
		ledger.finishLater(agentId, "eventually", 60);

		const first = await waitForAgents(ledger.get, [agentId], { timeoutMs: 20 });
		assert.deepEqual(first.completed, []);
		assert.deepEqual(first.running, [agentId]);
		assert.equal(first.timedOut, true);

		const second = await waitForAgents(ledger.get, [agentId], { timeoutMs: 1000 });
		assert.deepEqual(second.completed, [{ agentId, result: "eventually" }]);
		assert.deepEqual(second.running, []);
		assert.equal(second.timedOut, false);
	});

	it("returns immediately when the abort signal already fired", async () => {
		const ledger = makeLedger();
		const agentId = ledger.spawn(); // never finishes
		const controller = new AbortController();
		controller.abort();

		const outcome = await waitForAgents(ledger.get, [agentId], { timeoutMs: 1000, signal: controller.signal });
		assert.deepEqual(outcome.completed, []);
		assert.deepEqual(outcome.running, [agentId]);
		assert.equal(outcome.timedOut, false);
		assert.equal(outcome.aborted, true);
	});

	it("stops waiting when the abort signal fires mid-wait instead of timing out", async () => {
		const ledger = makeLedger();
		const agentId = ledger.spawn(); // never finishes
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 20);
		const started = Date.now();

		const outcome = await waitForAgents(ledger.get, [agentId], { timeoutMs: 1000, signal: controller.signal });
		assert.deepEqual(outcome.completed, []);
		assert.deepEqual(outcome.running, [agentId]);
		assert.equal(outcome.timedOut, false);
		assert.equal(outcome.aborted, true);
		assert.ok(Date.now() - started < 500, "returns on abort rather than waiting out the timeout");
	});

	it("applies no timeout when all requested agents resolve", async () => {
		const ledger = makeLedger();
		const agentId = ledger.spawn();
		ledger.finishLater(agentId, "done", 20);

		const outcome = await waitForAgents(ledger.get, [agentId], { timeoutMs: 1000 });
		assert.deepEqual(outcome.completed, [{ agentId, result: "done" }]);
		assert.equal(outcome.timedOut, false);
	});
});