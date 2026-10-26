import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseToolList } from "./agents.ts";

// The frontmatter `tools` value reaches this extension as one scalar string
// (pi's parseFrontmatter does not split it) and is turned into `pi --tools`,
// whose parser splits on commas. A whitespace-separated list used to collapse
// into a single bogus name, producing an allowlist that matched no tool — the
// delegated agent then started with an empty tool block (agnt-ctx-rpm3).

describe("parseToolList", () => {
	it("splits the comma-separated form", () => {
		assert.deepEqual(parseToolList("bash, read, grep, find, task"), [
			"bash",
			"read",
			"grep",
			"find",
			"task",
		]);
	});

	it("splits the space-separated form instead of collapsing it to one name", () => {
		assert.deepEqual(parseToolList("bash read grep find task"), [
			"bash",
			"read",
			"grep",
			"find",
			"task",
		]);
	});

	it("tolerates mixed and padded separators", () => {
		assert.deepEqual(parseToolList("  bash,read   grep ,\ttask "), [
			"bash",
			"read",
			"grep",
			"task",
		]);
	});

	it("returns undefined when there is no tool list", () => {
		assert.equal(parseToolList(undefined), undefined);
		assert.equal(parseToolList(""), undefined);
		assert.equal(parseToolList("   "), undefined);
	});
});
