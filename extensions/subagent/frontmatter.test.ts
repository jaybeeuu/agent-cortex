/**
 * The local frontmatter reader for agent files.
 *
 * pi's `parseFrontmatter` is unreachable from an installed extension, so this
 * parser reads the subset agent files use. Agents are user-authored files at a
 * system edge: a field this parser mishandles silently changes an agent's name,
 * description or tool list, and an exception here would break discovery of every
 * other agent, so both the parsing and the tolerance are covered.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseFrontmatter } from "./frontmatter.ts";

describe("parseFrontmatter", () => {
	it("splits fields from the body and trims the body", () => {
		const { frontmatter, body } = parseFrontmatter(`---\nname: ralph\ndescription: d\n---\n\n# ralph\n`);

		assert.deepEqual(frontmatter, { name: "ralph", description: "d" });
		assert.equal(body, "# ralph");
	});

	it("reads a quoted scalar, unescaping it", () => {
		const { frontmatter } = parseFrontmatter(`---\nname: "a: b\\"c\\n"\n---\n`);

		assert.equal(frontmatter.name, 'a: b"c\n');
	});

	it("reads a flow sequence of quoted items", () => {
		const { frontmatter } = parseFrontmatter(`---\ntools: ["bash", "read"]\n---\n`);

		assert.deepEqual(frontmatter.tools, ["bash", "read"]);
	});

	it("reads a block sequence", () => {
		const { frontmatter } = parseFrontmatter(`---\ntools:\n  - bash\n  - read\n---\n`);

		assert.deepEqual(frontmatter.tools, ["bash", "read"]);
	});

	it("keeps a comma-separated tool list as one scalar", () => {
		const { frontmatter } = parseFrontmatter(`---\ntools: "bash, read"\n---\n`);

		assert.equal(frontmatter.tools, "bash, read");
	});

	it("separates fields from a following block sequence", () => {
		const { frontmatter } = parseFrontmatter(`---\nname: ralph\ntools:\n  - bash\nmodel: fast\n---\n`);

		assert.deepEqual(frontmatter, { name: "ralph", tools: ["bash"], model: "fast" });
	});

	it("normalises CRLF line endings", () => {
		const { frontmatter, body } = parseFrontmatter(`---\r\nname: ralph\r\n---\r\n\r\nbody\r\n`);

		assert.deepEqual(frontmatter, { name: "ralph" });
		assert.equal(body, "body");
	});

	it("returns the whole document as body when there is no frontmatter", () => {
		const { frontmatter, body } = parseFrontmatter("# just markdown\n");

		assert.deepEqual(frontmatter, {});
		assert.equal(body, "# just markdown\n");
	});

	it("treats an unclosed block as body rather than throwing", () => {
		const { frontmatter, body } = parseFrontmatter(`---\nname: ralph\n`);

		assert.deepEqual(frontmatter, {});
		assert.equal(body, "---\nname: ralph\n");
	});
});
