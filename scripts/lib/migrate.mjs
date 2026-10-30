// @ts-check
// `agent-cortex migrate` — bring a beads workspace up to the latest
// agent-cortex layout, one versioned step at a time.
//
// The command is repo-agnostic: it talks to the `bd` CLI found on PATH
// (`BD_PATH` overrides), never to a hardcoded install path, and never to
// agent-cortex-specific labels. The only filesystem path it knows is the idea
// directory every workspace that used loose idea records keeps its files in
// (`docs/ideas`), and reading it is all step v2 does — the migration never
// writes or deletes a file.
//
// The current version is detected from the workspace's own state — the first
// step with pending work is the version boundary — so there is no side-car
// marker file to drift out of sync on a fresh clone, and a re-run after an
// apply is a no-op by construction.
//
// Dry run is the default. `--apply` runs every pending step in order up to the
// latest, verifying each one before moving on.

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// `bd export --all` on a large workspace is far bigger than execFile's 1 MiB
// default; the migration reads every bead in the workspace.
const MAX_BUFFER = 32 * 1024 * 1024;

/** Step v1 renames labels in this namespace to the two-axis execution namespace. */
const LEGACY_LABEL_PREFIX = "implementation-type:";
const EXECUTION_LABEL_PREFIX = "execution:";

/**
 * The values step v1 is allowed to rename. The documented contract is
 * `implementation-type:<afk|hitl>`, so any other value is a human decision the
 * migration must not guess at: renaming `wip` to `execution:wip` would invent a
 * routing label nothing queries.
 */
const V1_LABEL_VALUES = ["afk", "hitl"];

/**
 * Where loose idea records live, relative to the working directory. This is the
 * one path the command assumes, and it is deliberately the directory every
 * workspace with idea files already uses — a workspace without one simply has
 * nothing pending at v2.
 */
const DEFAULT_IDEA_DIR = "docs/ideas";

/**
 * The label that marks a bead as an unscoped idea. It is also what step v2
 * reads to decide which records already exist.
 */
const IDEA_LABEL = "kind:idea";

/**
 * Migrated ideas are `task` beads, and `bd lint` requires acceptance criteria on
 * one. An idea file has no acceptance section of its own — the criterion is the
 * promotion bar `record-idea` captures for a new idea, so a migrated record and
 * a freshly captured one lint the same way.
 */
const IDEA_ACCEPTANCE =
  "A promotion decision is recorded on this bead: a scoped epic/feature is spawned from it, or it is explicitly rejected.";

/**
 * Section aliases for `--description` and `--design`. The idea files predate a
 * single template, so a heading is matched by normalised name — case-folded,
 * trailing parenthetical ignored — rather than by exact text: `## Problem` and
 * the legacy `## Why it might be useful` are the same field, and
 * `## Fleshed-out design (decided 2026-08-25)` is still the design field.
 *
 * Every other `##` section lands in `--notes` in file order, markers preserved,
 * so a one-off section a file added is carried over instead of dropped.
 */
const DESCRIPTION_SECTIONS = ["problem", "why it might be useful", "who benefits", "proposed outcome"];
const DESIGN_SECTIONS = ["how we might do it", "fleshed-out design", "design so far / provenance"];

/**
 * The idea files carry no `priority:` field: a few use a `## Priority` heading
 * and the rest state it in prose ("priority P2 (moderate)", "P3 by the author").
 * The first `P<n>` token anywhere in the file is therefore the priority, and a
 * file that states none is backlog — P4.
 */
const PRIORITY_PATTERN = /\bP([0-4])\b/;
const DEFAULT_PRIORITY = 4;

/** @typedef {(args: string[]) => Promise<string>} BdRunner */
/**
 * What a step works against: the `bd` runner plus the workspace facts a probe
 * may need. Step v2 reads the filesystem, so the context carries the idea
 * directory rather than leaving the step to guess one.
 *
 * @typedef {{ bd: BdRunner, dir: string }} StepContext
 */
/** @typedef {{ from: string, to: string }} LabelRename */
/** @typedef {{ id: string, renames: LabelRename[] }} PendingBead */
/**
 * @typedef {object} PendingIdea
 * @property {string} file        Source file path, as reported in the plan.
 * @property {string} title       Bead title, `Idea: ` prefixed.
 * @property {number} priority    0–4.
 * @property {string} description `--description` body.
 * @property {string} design      `--design` body.
 * @property {string} notes       `--notes` body.
 */
/** @typedef {PendingBead | PendingIdea} Pending */

/**
 * One registry entry. `detect` is both the version probe (empty result = the
 * step is already applied) and the input to `apply`, so a step can never plan
 * one thing and write another. `plan` renders that pending work as the dry
 * run's lines, so the printout never has to know a step's pending shape.
 *
 * @typedef {object} MigrationStep
 * @property {number} version                       Version this step migrates the workspace to.
 * @property {string} name                          Stable identifier, used in output.
 * @property {string} describe                      One-line description of the change.
 * @property {(ctx: StepContext) => Promise<Pending[]>} detect      Pending work, empty when applied.
 * @property {(pending: Pending[]) => string[]} plan                One line per pending item.
 * @property {(ctx: StepContext, pending: Pending[]) => Promise<void>} apply  Write the change.
 */

/**
 * The `bd` runner. Resolved per call so a test or a machine-specific install
 * can override it without a hardcoded path (see the BD_PATH convention shared
 * with the other bd-driving tools in this repo).
 *
 * @returns {BdRunner}
 */
function bdRunner() {
  const bin = process.env.BD_PATH || "bd";
  return async (args) => {
    try {
      const { stdout } = await execFileAsync(bin, args, { encoding: "utf-8", maxBuffer: MAX_BUFFER });
      return stdout;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
        throw new Error(`bd not found (${bin}). Install the beads CLI or set BD_PATH.`);
      }
      const stderr = /** @type {{ stderr?: string }} */ (err).stderr;
      const detail = stderr && stderr.trim() ? stderr.trim() : /** @type {Error} */ (err).message;
      throw new Error(`bd ${args.slice(0, 2).join(" ")} failed: ${detail}`);
    }
  };
}

/**
 * Every issue in the workspace, read from `bd export --all` (JSONL). The export
 * reports each record's labels whatever its status, so closed beads are in
 * scope. A label-filtered `bd list` hides closed beads on some bd builds, and
 * relying on it is how a partially migrated workspace once reported itself as
 * up to date.
 *
 * Non-issue records (memories and other infrastructure beads) are skipped. A
 * line that is not JSON, or an issue without an id, fails loudly instead of
 * shrinking the result set silently.
 *
 * @param {BdRunner} bd
 * @returns {Promise<Array<{ id: string, labels: string[] }>>}
 */
async function exportIssues(bd) {
  const stdout = await bd(["export", "--all"]);
  /** @type {Array<{ id: string, labels: string[] }>} */
  const issues = [];
  const lines = stdout.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line === "") continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`bd export --all returned a non-JSON line at line ${index + 1}`);
    }
    if (typeof record?._type === "string" && record._type !== "issue") continue;
    if (typeof record?.id !== "string") {
      throw new Error(`bd export --all returned an issue without an id at line ${index + 1}`);
    }
    issues.push({ id: record.id, labels: Array.isArray(record.labels) ? record.labels : [] });
  }

  return issues;
}

/**
 * Labels present anywhere in the workspace, closed beads included, from the
 * label index. The migration cross-checks the export against it: a legacy label
 * the index reports but the export cannot attribute to a bead means the export
 * lost data, and the workspace must not be called migrated.
 *
 * @param {BdRunner} bd
 * @returns {Promise<string[]>}
 */
async function listIndexedLabels(bd) {
  const entries = JSON.parse(await bd(["label", "list-all", "--json"]));
  if (!Array.isArray(entries)) throw new Error("bd label list-all --json did not return an array");

  return entries.map((entry) => {
    if (typeof entry?.label !== "string") {
      throw new Error("bd label list-all --json returned an entry without a label");
    }
    return entry.label;
  });
}

/**
 * Find every bead still carrying an `implementation-type:` label, grouped per
 * bead. Closed beads are included: the migration's goal is an empty legacy
 * namespace, so history labels are renamed too.
 *
 * A value outside the step's allowlist is a blocking error, not a rename to
 * guess at — the message names each offending bead and label, and detection
 * runs before any write, so both the dry run and `--apply` change nothing.
 *
 * @param {StepContext} ctx
 * @returns {Promise<PendingBead[]>}
 */
async function findLegacyLabelBeads({ bd }) {
  /** @type {PendingBead[]} */
  const pending = [];
  /** @type {string[]} */
  const unmapped = [];

  for (const bead of await exportIssues(bd)) {
    /** @type {LabelRename[]} */
    const renames = [];
    for (const label of bead.labels) {
      if (!label.startsWith(LEGACY_LABEL_PREFIX)) continue;
      const value = label.slice(LEGACY_LABEL_PREFIX.length);
      if (value === "") throw new Error(`cannot migrate malformed label "${label}" on ${bead.id}`);
      // Refuse the whole run rather than renaming the rest and leaving an
      // invented label behind: a half-migrated workspace starves silently.
      if (!V1_LABEL_VALUES.includes(value)) {
        unmapped.push(`${bead.id}: ${label}`);
        continue;
      }
      renames.push({ from: label, to: `${EXECUTION_LABEL_PREFIX}${value}` });
    }
    if (renames.length > 0) pending.push({ id: bead.id, renames });
  }

  if (unmapped.length > 0) {
    throw new Error(
      `v1 label-rename only maps ${LEGACY_LABEL_PREFIX}${V1_LABEL_VALUES.join("|")} to ` +
        `${EXECUTION_LABEL_PREFIX}${V1_LABEL_VALUES.join("|")}, but ${unmapped.length} label(s) carry another ` +
        `value — refusing to migrate:\n${unmapped.map((entry) => `  ${entry}`).join("\n")}\n` +
        "Correct or remove those labels, then re-run.",
    );
  }

  const residual = (await listIndexedLabels(bd)).filter((label) => label.startsWith(LEGACY_LABEL_PREFIX));
  if (pending.length === 0 && residual.length > 0) {
    throw new Error(
      `no bead in bd export --all carries ${residual.join(", ")}, but the label index still does — ` +
        "refusing to report the workspace as migrated",
    );
  }

  return pending.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Apply the label rename in batches: add the target label for a group of beads,
 * then remove the legacy one, so a bead is never left without its axis label.
 *
 * @param {StepContext} ctx
 * @param {Pending[]} pending
 * @returns {Promise<void>}
 */
async function renameLegacyLabels({ bd }, pending) {
  /** @type {Map<string, { to: string, ids: string[] }>} */
  const groups = new Map();
  for (const bead of pending.filter(isPendingBead)) {
    for (const { from, to } of bead.renames) {
      const group = groups.get(from) ?? { to, ids: [] };
      group.ids.push(bead.id);
      groups.set(from, group);
    }
  }

  for (const from of [...groups.keys()].sort()) {
    const { to, ids } = /** @type {{ to: string, ids: string[] }} */ (groups.get(from));
    await bd(["label", "add", ...ids, to]);
    await bd(["label", "remove", ...ids, from]);
  }
}

/**
 * Split a markdown body into its `##` sections and the lines that precede the
 * first one. Level-3 headings stay inside their parent section: a `###` block is
 * part of the design or note it belongs to, not a field of its own.
 *
 * @param {string[]} lines
 * @returns {{ sections: Array<{ heading: string, lines: string[] }>, preamble: string[] }}
 */
function splitSections(lines) {
  /** @type {Array<{ heading: string, lines: string[] }>} */
  const sections = [];
  /** @type {string[]} */
  const preamble = [];
  /** @type {{ heading: string, lines: string[] } | null} */
  let current = null;

  for (const line of lines) {
    const heading = /^##(?!#)\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = { heading: heading[1], lines: [] };
      sections.push(current);
      continue;
    }
    if (current === null) preamble.push(line);
    else current.lines.push(line);
  }

  return { sections, preamble };
}

/**
 * Render a section back to markdown with its `##` marker: the marker is the
 * contract `flesh-out-idea` reads a bead's fields by.
 *
 * @param {{ heading: string, lines: string[] }} section
 * @returns {string}
 */
function renderSection({ heading, lines }) {
  const body = lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
  return body === "" ? `## ${heading}` : `## ${heading}\n${body}`;
}

/**
 * A heading's alias key: case-folded, with a trailing parenthetical dropped so
 * `## Fleshed-out design (decided 2026-08-25)` still matches `fleshed-out design`.
 *
 * @param {string} heading
 * @returns {string}
 */
function sectionKey(heading) {
  return heading.trim().toLowerCase().replace(/\s*\([^()]*\)\s*$/, "");
}

/**
 * A title's comparison key: the `Idea: ` / `Design: ` prefix dropped, case
 * folded, and only letters and digits kept. A record already migrated by hand
 * was titled `Design: …`, and a file name writes the same words with hyphens,
 * so both sides reduce to the same key and collide.
 *
 * @param {string} title
 * @returns {string}
 */
function titleKey(title) {
  return title
    .replace(/^\s*(?:idea|design)\s*:\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * The lines under a `## Provenance` heading — how a record migrated by hand
 * cites the file it came from. Only that section is consulted: neighbouring
 * ideas are cross-referenced all over the notes, and a cross-reference is not
 * evidence that a file has been recorded.
 *
 * @param {string} text
 * @returns {string}
 */
function provenanceText(text) {
  return splitSections(text.split("\n"))
    .sections.filter((section) => /^provenance/i.test(section.heading))
    .map((section) => section.lines.join("\n"))
    .join("\n");
}

/**
 * One markdown idea file → the bead fields it becomes.
 *
 * No content loss is the contract: the `#` title line becomes the bead title and
 * every other line lands in exactly one of description, design, or notes.
 *
 * @param {string} sourcePath
 * @param {string} markdown
 * @returns {PendingIdea}
 */
function parseIdeaFile(sourcePath, markdown) {
  /** @type {string[]} */
  const body = [];
  let heading = "";
  for (const line of markdown.split("\n")) {
    const title = heading === "" ? /^#\s+(.+?)\s*$/.exec(line) : null;
    if (title) {
      heading = title[1];
      continue;
    }
    body.push(line);
  }

  const { sections, preamble } = splitSections(body);
  /** @type {string[]} */
  const description = [];
  /** @type {string[]} */
  const design = [];
  /** @type {string[]} */
  const notes = [];

  const lead = preamble.join("\n").trim();
  if (lead !== "") description.push(lead);

  for (const section of sections) {
    const block = renderSection(section);
    if (DESCRIPTION_SECTIONS.includes(sectionKey(section.heading))) description.push(block);
    else if (DESIGN_SECTIONS.includes(sectionKey(section.heading))) design.push(block);
    else notes.push(block);
  }

  // A file whose heading is missing or is bare `Idea:` still needs a title; its
  // file name is the only name it has.
  const title = heading.replace(/^\s*(?:idea|design)\s*:\s*/i, "").trim();
  const priority = PRIORITY_PATTERN.exec(markdown);

  return {
    file: sourcePath,
    title: `Idea: ${title === "" ? basename(sourcePath, ".md").replace(/-/g, " ") : title}`,
    priority: priority === null ? DEFAULT_PRIORITY : Number(priority[1]),
    description: description.join("\n\n"),
    design: design.join("\n\n"),
    notes: notes.join("\n\n"),
  };
}

/**
 * `*.md` files under the idea directory, deepest one level (a multi-part idea
 * can live in its own folder). A missing directory is not an error: a workspace
 * that never used idea files has nothing pending at this step.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listIdeaPaths(dir) {
  /** @type {string[]} */
  const paths = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return paths;
    throw err;
  }

  const byName = (/** @type {{ name: string }} */ a, /** @type {{ name: string }} */ b) =>
    a.name.localeCompare(b.name);

  for (const entry of [...entries].sort(byName)) {
    const path = join(dir, entry.name);
    if (entry.isFile()) {
      if (entry.name.endsWith(".md")) paths.push(path);
      continue;
    }
    // Dot directories are workspace state (`.beads`, `.agent-cortex`), never ideas.
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    for (const nested of [...(await readdir(path, { withFileTypes: true }))].sort(byName)) {
      if (nested.isFile() && nested.name.endsWith(".md")) paths.push(join(path, nested.name));
    }
  }

  return paths;
}

/**
 * The idea beads that already exist, as the two facts the collision check needs:
 * a title key, and the text of any provenance section.
 *
 * `--all` keeps closed ideas in the answer — a closed idea bead means that file
 * is recorded, and a collision must skip it rather than mint a twin.
 *
 * @param {BdRunner} bd
 * @returns {Promise<Array<{ key: string, provenance: string }>>}
 */
async function listIdeaBeads(bd) {
  const entries = JSON.parse(await bd(["list", "-l", IDEA_LABEL, "--all", "--json", "--limit", "0"]));
  if (!Array.isArray(entries)) throw new Error(`bd list -l ${IDEA_LABEL} --json did not return an array`);

  return entries.map((entry) => ({
    key: titleKey(typeof entry?.title === "string" ? entry.title : ""),
    provenance: provenanceText(
      [entry?.description, entry?.design, entry?.notes, entry?.acceptance_criteria]
        .filter((field) => typeof field === "string")
        .join("\n\n"),
    ),
  }));
}

/**
 * Pending work for v2: every idea file whose record does not exist yet.
 *
 * A file is skipped when an idea bead already carries its title — the
 * migration's own output, so a re-run, or an `--apply` that died part-way, never
 * duplicates a record — or when a bead cites the file under a `## Provenance`
 * heading, which is how the records migrated by hand before this step existed
 * announce their source.
 *
 * @param {StepContext} ctx
 * @returns {Promise<PendingIdea[]>}
 */
async function findIdeaFiles(ctx) {
  const beads = await listIdeaBeads(ctx.bd);
  const titles = new Set(beads.map((bead) => bead.key).filter((key) => key !== ""));
  const provenance = beads.map((bead) => bead.provenance).join("\n");
  /** @type {PendingIdea[]} */
  const pending = [];

  for (const path of await listIdeaPaths(ctx.dir)) {
    const idea = parseIdeaFile(path, await readFile(path, "utf-8"));
    if (titles.has(titleKey(idea.title))) continue;
    if (provenance.includes(basename(path))) continue;
    pending.push(idea);
  }

  return pending;
}

/**
 * Create the beads one file at a time, so a run that dies part-way leaves only
 * the unmigrated files behind and the next `--apply` resumes exactly there.
 *
 * `kind:idea` marks the record as an unscoped idea and `execution:hitl` keeps it
 * out of agent-workable queries: an idea is human-owned until it is promoted,
 * and it stays out of the queue by *not* carrying `execution:afk`.
 *
 * @param {StepContext} ctx
 * @param {Pending[]} pending
 * @returns {Promise<void>}
 */
async function createIdeaBeads({ bd }, pending) {
  for (const idea of pending.filter(isIdeaFile)) {
    /** @type {string[]} */
    const args = [
      "create",
      idea.title,
      "--silent",
      "-l",
      `${IDEA_LABEL},${EXECUTION_LABEL_PREFIX}hitl`,
      "-p",
      `P${idea.priority}`,
    ];
    if (idea.description !== "") args.push("-d", idea.description);
    if (idea.design !== "") args.push("--design", idea.design);
    if (idea.notes !== "") args.push("--notes", idea.notes);
    args.push("--acceptance", IDEA_ACCEPTANCE);
    await bd(args);
  }
}

/**
 * @param {Pending} item
 * @returns {item is PendingBead}
 */
function isPendingBead(item) {
  return "renames" in item;
}

/**
 * @param {Pending} item
 * @returns {item is PendingIdea}
 */
function isIdeaFile(item) {
  return "file" in item;
}

/**
 * @param {Pending[]} pending
 * @returns {string[]}
 */
function planLabelRenames(pending) {
  return pending
    .filter(isPendingBead)
    .map((bead) => `${bead.id}: ${bead.renames.map(({ from, to }) => `${from} → ${to}`).join(", ")}`);
}

/**
 * @param {Pending[]} pending
 * @returns {string[]}
 */
function planIdeaBeads(pending) {
  return pending
    .filter(isIdeaFile)
    .map((idea) => `${idea.file} → ${idea.title} (P${idea.priority})`);
}

/** @type {MigrationStep[]} */
const STEPS = [
  {
    version: 1,
    name: "label-rename",
    describe: `${LEGACY_LABEL_PREFIX}<afk|hitl> → ${EXECUTION_LABEL_PREFIX}<afk|hitl>`,
    detect: findLegacyLabelBeads,
    plan: planLabelRenames,
    apply: renameLegacyLabels,
  },
  {
    version: 2,
    name: "ideas-to-beads",
    describe: `${DEFAULT_IDEA_DIR}/*.md → ${IDEA_LABEL} beads`,
    detect: findIdeaFiles,
    plan: planIdeaBeads,
    apply: createIdeaBeads,
  },
];

const LATEST_VERSION = STEPS[STEPS.length - 1].version;

/**
 * @typedef {object} MigrationState
 * @property {number} version                 Highest contiguous applied version.
 * @property {MigrationStep | null} step      First step with pending work, null when up to date.
 * @property {Pending[]} pending              That step's pending work.
 */

/**
 * Detect the workspace's current migration version. Stops at the first step
 * with pending work: later steps assume the earlier ones have run.
 *
 * @param {StepContext} ctx
 * @returns {Promise<MigrationState>}
 */
async function detectVersion(ctx) {
  let version = 0;
  for (const step of STEPS) {
    const pending = await step.detect(ctx);
    if (pending.length > 0) return { version, step, pending };
    version = step.version;
  }
  return { version, step: null, pending: [] };
}

/** @param {string} chunk */
function write(chunk) {
  process.stdout.write(chunk);
}

/**
 * @param {MigrationStep} step
 * @param {Pending[]} pending
 */
function summarize(step, pending) {
  return `    ${pending.length} bead(s) pending for v${step.version} ${step.name}\n`;
}

/**
 * The dry run's deliverable: one line per pending item, then the totals.
 *
 * @param {MigrationStep} step
 * @param {Pending[]} pending
 */
function writePlan(step, pending) {
  for (const line of step.plan(pending)) write(`    ${line}\n`);
  write(summarize(step, pending));
}

/**
 * Run `agent-cortex migrate`.
 *
 * @param {{ apply: boolean, dir?: string }} options
 *        `dir` overrides the idea source directory (default `docs/ideas`), which
 *        is what makes the step usable from a checkout that keeps its idea files
 *        somewhere else.
 * @returns {Promise<void>}
 */
export async function runMigrate({ apply, dir = DEFAULT_IDEA_DIR }) {
  const ctx = { bd: bdRunner(), dir };
  const current = await detectVersion(ctx);

  if (current.step === null) {
    write(`agent-cortex migrate: already at v${LATEST_VERSION} — nothing to do.\n`);
    return;
  }

  if (!apply) {
    write(`agent-cortex migrate: dry run (workspace at v${current.version}, latest v${LATEST_VERSION})\n`);
    write(`  v${current.step.version} ${current.step.name}: ${current.step.describe}\n`);
    writePlan(current.step, current.pending);
    write("No changes written. Re-run with --apply to write.\n");
    return;
  }

  write(`agent-cortex migrate: v${current.version} → v${LATEST_VERSION}\n`);
  let state = current;
  while (state.step !== null) {
    const step = state.step;
    write(`  v${step.version} ${step.name}: ${step.describe}\n`);
    write(summarize(step, state.pending));

    await step.apply(ctx, state.pending);

    const remaining = await step.detect(ctx);
    if (remaining.length > 0) {
      const files = step.plan(remaining).join(", ");
      throw new Error(
        `v${step.version} ${step.name} verification failed — ${remaining.length} item(s) still pending: ${files}`,
      );
    }
    write(`  ✓ v${step.version} ${step.name} verified\n`);

    const next = await detectVersion(ctx);
    if (next.step !== null && next.step.version <= step.version) {
      throw new Error(`migration did not advance past v${step.version}`);
    }
    state = next;
  }
  write(`agent-cortex migrate: now at v${LATEST_VERSION}.\n`);
}
