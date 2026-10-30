// PR gate: a pull request must add a changeset (.changeset/*.md) unless it is
// the changesets bot's Version Packages PR or carries the `no-publish` label.
// Reads `git diff --name-status <base>...HEAD` on stdin and the PR metadata
// from the environment (CI supplies all three).
import { evaluateChangesetGate, parseNameStatus } from "./lib/release-gates.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function readLabels(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    console.error("::error::PR_LABELS must be a JSON array of label names.");
    process.exit(1);
  }
}

const labels = readLabels(process.env.PR_LABELS ?? "[]");
const changes = parseNameStatus(await readStdin());
const result = evaluateChangesetGate({
  changes,
  labels,
  headRef: process.env.PR_HEAD_REF ?? "",
  actor: process.env.PR_ACTOR ?? "",
});

if (result.ok) {
  console.log(`✓ Changeset gate passed (${result.reason}).`);
} else {
  console.error(
    [
      "::error::This PR adds no changeset (.changeset/*.md).",
      "Publishing is the default: write a changeset file (see the style-versioning skill)",
      "and commit it, or label the PR 'no-publish' when it genuinely ships nothing.",
    ].join("\n"),
  );
  process.exitCode = 1;
}
