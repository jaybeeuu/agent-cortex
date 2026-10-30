// Release gate: print the single-token publish command changesets/action
// should exec. The merged PR's labels arrive as a JSON array in argv[2]; the
// action splits the printed command on whitespace with no shell, so it must
// stay a plain `pnpm <script>` token pair.
import { resolvePublishCommand } from "./lib/release-gates.mjs";

/**
 * @param {string} raw
 * @returns {string[]}
 */
function readLabels(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    console.error("::error::labels argument must be a JSON array of label names.");
    process.exit(1);
  }
}

const labels = readLabels(process.argv[2] ?? "[]");
process.stdout.write(`${resolvePublishCommand(labels)}\n`);
