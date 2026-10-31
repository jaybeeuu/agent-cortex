/**
 * The local transcript components pi's renderers draw for the subagent tool.
 *
 * pi-tui's own components are unreachable from an installed extension, so these
 * implement pi's `Component` contract directly. The contract that matters is the
 * width: pi-tui reports a rendered line wider than the terminal as an error, so
 * every line these return must fit the width they are given, with SGR colour
 * sequences still intact.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Container, Spacer, Text } from "./components.ts";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";

/** Visible column count, ignoring SGR sequences. */
function visibleWidth(line: string): number {
	return line.replace(/\x1b\[[0-9;]*m/g, "").length;
}

describe("Text", () => {
	it("wraps a long line to the width it is given", () => {
		const lines = new Text("alpha beta gamma delta").render(11);

		assert.deepEqual(lines, ["alpha beta", "gamma delta"]);
		assert.ok(lines.every((line) => visibleWidth(line) <= 11));
	});

	it("hard-wraps a word longer than the width instead of overflowing", () => {
		const lines = new Text("abcdefghij").render(4);

		assert.deepEqual(lines, ["abcd", "efgh", "ij"]);
	});

	it("keeps a colour sequence intact and carries it onto the wrapped line", () => {
		const lines = new Text(`${GREEN}alpha beta gamma${RESET}`).render(11);

		assert.equal(lines.length, 2);
		for (const line of lines) assert.ok(visibleWidth(line) <= 11, `width of ${JSON.stringify(line)}`);
		assert.ok(lines[0].endsWith(RESET), "a line cut inside a colour span closes it");
		assert.ok(lines[1].startsWith(GREEN), "the continuation reopens the colour");
		assert.equal(lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "")).join(" "), "alpha beta gamma");
	});

	it("pads and separates lines with the padding it is given", () => {
		const lines = new Text("body", 1, 1).render(10);

		assert.deepEqual(lines, ["  ", " body ", "  "]);
	});

	it("keeps an empty line and renders blank text as one empty line", () => {
		assert.deepEqual(new Text("a\n\nb").render(10), ["a", "", "b"]);
		assert.deepEqual(new Text().render(10), [""]);
	});
});

describe("Spacer", () => {
	it("renders the blank lines it was asked for", () => {
		assert.deepEqual(new Spacer(2).render(10), ["", ""]);
		assert.deepEqual(new Spacer().render(10), [""]);
	});
});

describe("Container", () => {
	it("draws its children in order, each at the given width", () => {
		const container = new Container();
		container.addChild(new Text("alpha beta"));
		container.addChild(new Spacer(1));
		container.addChild(new Text("gamma"));

		assert.deepEqual(container.render(5), ["alpha", "beta", "", "gamma"]);
	});
});
