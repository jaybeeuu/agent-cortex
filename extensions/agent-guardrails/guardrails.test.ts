import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GUARDRAILS, GUARDRAILS_MARKER, appendGuardrails } from "./guardrails.ts";

// ─── appendGuardrails ─────────────────────────────────────────────────────────

describe("appendGuardrails", () => {
  it("appends the guardrails block after the base prompt", () => {
    const result = appendGuardrails("You are a helpful agent.");

    assert.ok(result.startsWith("You are a helpful agent."));
    assert.ok(result.includes(GUARDRAILS));
  });

  it("preserves a chained base prompt from earlier handlers", () => {
    const base = "Base prompt.\n\n---\nAgent mode instructions.";
    const result = appendGuardrails(base);

    assert.ok(result.startsWith(base));
  });

  it("trims trailing whitespace before appending", () => {
    const result = appendGuardrails("Base prompt.\n\n");

    assert.equal(result, `Base prompt.\n\n${GUARDRAILS}`);
  });

  it("is idempotent when applied twice", () => {
    const once = appendGuardrails("Base prompt.");
    const twice = appendGuardrails(once);

    assert.equal(twice, once);
    assert.equal(twice.split(GUARDRAILS_MARKER).length - 1, 1);
  });

  it("returns the prompt unchanged when the guardrails are already present", () => {
    const existing = `Base prompt.\n\n${GUARDRAILS}`;

    assert.equal(appendGuardrails(existing), existing);
  });
});
