// Shared test helper: a stateful fake `bd` binary for `agent-cortex migrate`.
// The real beads database must never be touched by tests, so the CLI is driven
// against this fake through the BD_PATH override. The fake reproduces the
// `bd` behaviours the migration depends on:
//   - `bd list --label-pattern <glob> --json` returns matching beads, and
//     hides closed beads unless `--all` is passed (the default bd filter);
//   - `bd label add <ids...> <label>` / `bd label remove <ids...> <label>`
//     mutate the bead's labels;
//   - every write is appended to `writes`, so a test can prove a dry run wrote
//     nothing;
//   - `failOn` (e.g. "label add") makes that subcommand exit 1, exercising the
//     fail-loud path.
//
// State lives in `state.json` next to the binary. Written async throughout —
// the repo's check-no-sync lint scans test/ (including helpers).

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FAKE_BD_SCRIPT = `#!/usr/bin/env node
// Stateful fake for the bd commands agent-cortex migrate uses
// (test/helpers/fake-bd-migrate.mjs).
const fs = require("node:fs/promises");

const stateFile = process.env.FAKE_BD_STATE;

/** Glob match for --label-pattern (only "*" may appear as a wildcard). */
function matchesPattern(pattern, label) {
  const parts = pattern.split("*");
  if (parts.length === 1) return label === pattern;
  if (!label.startsWith(parts[0])) return false;
  let rest = label.slice(parts[0].length);
  for (let i = 1; i < parts.length - 1; i++) {
    const at = rest.indexOf(parts[i]);
    if (at === -1) return false;
    rest = rest.slice(at + parts[i].length);
  }
  return rest.endsWith(parts[parts.length - 1]);
}

(async () => {
  const argv = process.argv.slice(2);
  const [command, sub] = argv;
  const state = JSON.parse(await fs.readFile(stateFile, "utf8"));

  const invoked = [command, sub].filter(Boolean).join(" ");
  if (state.failOn && state.failOn === invoked) {
    console.error("bd " + invoked + " failed: simulated bd error");
    process.exit(1);
  }

  if (command === "list") {
    const patternAt = argv.indexOf("--label-pattern");
    const pattern = patternAt === -1 ? "*" : argv[patternAt + 1];
    const includeClosed = argv.includes("--all");
    const beads = state.beads.filter((bead) => {
      const status = bead.status || "open";
      if (status === "closed" && !includeClosed) return false;
      return bead.labels.some((label) => matchesPattern(pattern, label));
    });
    process.stdout.write(JSON.stringify(beads.map(({ id, labels, status }) => ({
      id,
      labels,
      status: status || "open",
    }))));
    return;
  }

  if (command === "label" && (sub === "add" || sub === "remove")) {
    const args = argv.slice(2);
    const label = args.pop();
    for (const id of args) {
      const bead = state.beads.find((candidate) => candidate.id === id);
      if (!bead) {
        console.error("bd label " + sub + ": unknown issue " + id);
        process.exit(1);
      }
      const labels = new Set(bead.labels);
      if (sub === "add") labels.add(label);
      else labels.delete(label);
      bead.labels = [...labels];
    }
    state.writes.push({ op: sub, ids: args, label });
    await fs.writeFile(stateFile, JSON.stringify(state));
    return;
  }

  console.error("fake bd: unsupported command: " + argv.join(" "));
  process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

/**
 * Create a stateful fake `bd` binary in `dir`.
 *
 * @param {string} dir  Directory to hold the binary and its state.json
 * @param {{ beads: Array<{ id: string, labels: string[], status?: string }>, failOn?: string | null }} seed
 *        Pre-existing beads and an optional subcommand that must fail
 * @returns {Promise<{ bin: string, state: string }>}
 */
export async function makeFakeBdMigrate(dir, { beads, failOn = null }) {
  const bin = join(dir, "bd");
  const state = join(dir, "state.json");
  await writeFile(bin, FAKE_BD_SCRIPT);
  await chmod(bin, 0o755);
  await writeFile(state, JSON.stringify({ beads, failOn, writes: [] }));
  return { bin, state };
}
