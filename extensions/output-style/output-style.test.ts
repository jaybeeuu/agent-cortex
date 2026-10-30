import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { OUTPUT_STYLE, OUTPUT_STYLE_MARKER, appendOutputStyle } from "./output-style.ts";

// ─── appendOutputStyle ────────────────────────────────────────────────────────

describe("appendOutputStyle", () => {
  it("appends the output-style block after the base prompt", () => {
    const result = appendOutputStyle("You are a helpful agent.");

    assert.ok(result.startsWith("You are a helpful agent."));
    assert.ok(result.includes(OUTPUT_STYLE));
  });

  it("preserves a chained base prompt from earlier handlers", () => {
    const base = "Base prompt.\n\n---\nAgent mode instructions.";
    const result = appendOutputStyle(base);

    assert.ok(result.startsWith(base));
  });

  it("trims trailing whitespace before appending", () => {
    const result = appendOutputStyle("Base prompt.\n\n");

    assert.equal(result, `Base prompt.\n\n${OUTPUT_STYLE}`);
  });

  it("keeps a block appended by another extension", () => {
    const withGuardrails = "Base prompt.\n\n## Operating discipline (agent-cortex)\n\nRules.\n";
    const result = appendOutputStyle(withGuardrails);

    assert.ok(result.includes("## Operating discipline (agent-cortex)"));
    assert.ok(result.endsWith(OUTPUT_STYLE));
  });

  it("is idempotent when applied twice", () => {
    const once = appendOutputStyle("Base prompt.");
    const twice = appendOutputStyle(once);

    assert.equal(twice, once);
    assert.equal(twice.split(OUTPUT_STYLE_MARKER).length - 1, 1);
  });

  it("returns the prompt unchanged when the output style is already present", () => {
    const existing = `Base prompt.\n\n${OUTPUT_STYLE}`;

    assert.equal(appendOutputStyle(existing), existing);
  });
});
