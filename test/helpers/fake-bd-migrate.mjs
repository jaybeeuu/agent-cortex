// Shared test helper: a stateful fake `bd` binary for `agent-cortex migrate`.
// The real beads database must never be touched by tests, so the CLI is driven
// against this fake through the BD_PATH override. The fake reproduces the
// `bd` behaviours the migration depends on:
//   - `bd export --all` streams one JSONL record per issue, labels included
//     whatever the issue's status, plus a non-issue memory record (bd 1.3.1
//     exports those under --all and they carry no id);
//   - `bd label list-all --json` reports every label in the workspace with the
//     number of issues carrying it, closed beads included;
//   - `bd list --label-pattern <glob> --json` returns matching beads, and
//     hides closed beads unless `--all` is passed (see `listHidesClosed` for
//     the bd builds that hide them even then);
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

  if (command === "export") {
    const lines = state.beads.map((bead) => {
      const record = { _type: "issue", id: bead.id, status: bead.status || "open" };
      // bd omits the labels field entirely when an issue has none.
      if (bead.labels.length > 0) {
        record.labels = bead.labels.filter((label) => label !== state.exportDropsLabel);
      }
      return JSON.stringify(record);
    });
    // bd export --all also emits non-issue records, and those carry no id.
    lines.push(JSON.stringify({ _type: "memory", key: "fake-memory", value: "not an issue" }));
    process.stdout.write(lines.join("\\n") + "\\n");
    return;
  }

  if (command === "label" && sub === "list-all") {
    const counts = new Map();
    for (const bead of state.beads) {
      for (const label of bead.labels) counts.set(label, (counts.get(label) || 0) + 1);
    }
    const entries = [...counts.keys()].sort().map((label) => ({ label, count: counts.get(label) }));
    process.stdout.write(
      argv.includes("--json")
        ? JSON.stringify(entries)
        : entries.map((entry) => entry.label + "   (" + entry.count + " issues)").join("\\n") + "\\n",
    );
    return;
  }

  if (command === "list") {
    const patternAt = argv.indexOf("--label-pattern");
    const pattern = patternAt === -1 ? "*" : argv[patternAt + 1];
    const includeClosed = argv.includes("--all") && !state.listHidesClosed;
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
      else if (!state.ignoreLabelRemovals) labels.delete(label);
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
 * @param {{
 *   beads: Array<{ id: string, labels: string[], status?: string }>,
 *   failOn?: string | null,
 *   listHidesClosed?: boolean,
 *   ignoreLabelRemovals?: boolean,
 *   exportDropsLabel?: string | null,
 * }} seed
 *        Pre-existing beads, plus optional degradations that model bd builds
 *        which lose data: a label-filtered list that hides closed beads, a
 *        label removal that does not stick, and an export that drops a label.
 * @returns {Promise<{ bin: string, state: string }>}
 */
export async function makeFakeBdMigrate(
  dir,
  { beads, failOn = null, listHidesClosed = false, ignoreLabelRemovals = false, exportDropsLabel = null },
) {
  const bin = join(dir, "bd");
  const state = join(dir, "state.json");
  await writeFile(bin, FAKE_BD_SCRIPT);
  await chmod(bin, 0o755);
  await writeFile(
    state,
    JSON.stringify({ beads, failOn, listHidesClosed, ignoreLabelRemovals, exportDropsLabel, writes: [] }),
  );
  return { bin, state };
}
