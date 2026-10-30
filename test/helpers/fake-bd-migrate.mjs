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
//   - `bd list -l <label> --all --json --limit 0` returns the whole issue rows,
//     free-form fields included, which is how the ideas step recognises records
//     that already exist;
//   - `bd create <title> --silent [flags]` appends a bead and prints only its id,
//     recording the labels, priority, and fields it was given;
//   - `bd label add <ids...> <label>` / `bd label remove <ids...> <label>`
//     mutate the bead's labels;
//   - every write is appended to `writes`, so a test can prove a dry run wrote
//     nothing;
//   - `failOn` makes a command (`create`) or a subcommand (`label add`) exit 1,
//     exercising the fail-loud path.
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

/**
 * Every value following one of the given flag spellings, in argv order.
 * Comma-separated values are split the way bd splits labels.
 */
function flagValues(argv, names) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (!names.includes(argv[i])) continue;
    values.push(argv[i + 1]);
    i++;
  }
  return values;
}

/** The single value of the last occurrence of a flag, or null. */
function flag(argv, names) {
  const values = flagValues(argv, names);
  return values.length === 0 ? null : values[values.length - 1];
}

function labelsOf(bead) {
  return Array.isArray(bead.labels) ? bead.labels : [];
}

function row(bead) {
  const row = {
    id: bead.id,
    title: bead.title === undefined ? bead.id : bead.title,
    status: bead.status || "open",
    priority: bead.priority === undefined ? 2 : bead.priority,
    labels: labelsOf(bead),
  };
  // Free-form fields: bd omits one the issue does not carry.
  for (const field of ["description", "design", "acceptance_criteria", "notes"]) {
    if (typeof bead[field] === "string" && bead[field] !== "") row[field] = bead[field];
  }
  return row;
}

(async () => {
  const argv = process.argv.slice(2);
  const [command, sub] = argv;
  const state = JSON.parse(await fs.readFile(stateFile, "utf8"));

  const invoked = [command, sub].filter(Boolean).join(" ");
  // A bare command name fails every invocation of it ('create'), while a
  // command plus subcommand targets one ('label add').
  if (state.failOn && (state.failOn === invoked || state.failOn === command)) {
    console.error("bd " + invoked + " failed: simulated bd error");
    process.exit(1);
  }

  if (command === "export") {
    const lines = state.beads.map((bead) => {
      const record = { _type: "issue", id: bead.id, status: bead.status || "open" };
      // bd omits the labels field entirely when an issue has none.
      if (labelsOf(bead).length > 0) {
        record.labels = labelsOf(bead).filter((label) => label !== state.exportDropsLabel);
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
      for (const label of labelsOf(bead)) counts.set(label, (counts.get(label) || 0) + 1);
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
    const labelFilters = flagValues(argv, ["-l", "--label", "--labels"]).flatMap((value) =>
      String(value).split(",").filter(Boolean),
    );
    const patternAt = argv.indexOf("--label-pattern");
    const pattern = patternAt === -1 ? "*" : argv[patternAt + 1];
    const includeClosed = argv.includes("--all") && !state.listHidesClosed;
    const beads = state.beads.filter((bead) => {
      const status = bead.status || "open";
      if (status === "closed" && !includeClosed) return false;
      if (!labelFilters.every((label) => labelsOf(bead).includes(label))) return false;
      return labelsOf(bead).some((label) => matchesPattern(pattern, label));
    });
    // Plain list output is a bare array of rows; --json is the same payload.
    process.stdout.write(JSON.stringify(beads.map(row)));
    return;
  }

  if (command === "create") {
    const args = argv.slice(1);
    const title = args[0] && !args[0].startsWith("-") ? args[0] : flag(args, ["--title"]);
    const labels = flagValues(args, ["-l", "--labels"]).flatMap((value) => String(value).split(","));
    const priority = flag(args, ["-p", "--priority"]);
    const id = "fake-" + (state.beads.length + 1);
    const bead = {
      id,
      labels: labels.filter(Boolean),
      status: "open",
      title: title === null ? id : title,
    };
    if (priority !== null) bead.priority = Number(String(priority).replace(/^P/i, ""));
    for (const [names, field] of [
      [["-d", "--description"], "description"],
      [["--design"], "design"],
      [["--notes"], "notes"],
      [["--acceptance"], "acceptance_criteria"],
    ]) {
      const value = flag(args, names);
      if (value !== null) bead[field] = value;
    }
    state.beads.push(bead);
    state.writes.push({ op: "create", id, title: bead.title, labels: bead.labels });
    await fs.writeFile(stateFile, JSON.stringify(state));
    process.stdout.write(argv.includes("--silent") ? id + "\\n" : JSON.stringify(row(bead)) + "\\n");
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
      const labels = new Set(labelsOf(bead));
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
 *   beads: Array<{
 *     id: string,
 *     labels: string[],
 *     status?: string,
 *     title?: string,
 *     priority?: number,
 *     description?: string,
 *     design?: string,
 *     notes?: string,
 *     acceptance_criteria?: string,
 *   }>,
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
