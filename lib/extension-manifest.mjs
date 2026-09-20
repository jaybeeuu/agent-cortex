// Committed per-harness extension manifests (see docs/ideas/extension-manifests.md).
//
// agent-cortex ships one JSON manifest per harness declaring the THIRD-PARTY
// extensions that `agent-cortex ext install` should provision. The manifest is
// the single source of truth: adding an extension is an edit + commit (reviewed
// via the normal PR flow), and the CLI never writes a manifest.
//
// agent-cortex's OWN bundled extensions are deliberately excluded — they ride
// pi package discovery (`package.json` `pi.extensions`).
//
// This module is pure: parsing and planning only, no I/O and no spawning, so
// both the CLI and the tests can reason about the install plan deterministically.

import { join } from "node:path";

/** Harnesses with a committed extension manifest, and their manifest filenames. */
export const MANIFEST_FILES = {
  claude: "claude.extensions.json",
  pi: "pi.extensions.json",
};

/** Harnesses `agent-cortex ext install` supports (copilot has no manifest yet). */
export const EXT_HARNESSES = ["claude", "pi"];

/** Absolute path to `harness`'s manifest inside the package rooted at `root`. */
export function manifestFileFor(root, harness) {
  const file = MANIFEST_FILES[harness];
  if (!file) throw new Error(`no extension manifest is defined for harness "${harness}"`);
  return join(root, file);
}

/**
 * Parse a committed manifest body.
 *
 * Accepts a bare JSON array or an object with an `extensions` array; each entry
 * is either a source string or `{ source, description? }`. Sources are trimmed
 * and must be unique. When `expectedHarness` is given, a declared `harness`
 * field that disagrees is rejected — a copy-paste guard for per-harness files.
 *
 * @param {string} raw  Manifest file contents
 * @param {{ path?: string, expectedHarness?: string }} [options]
 * @returns {{ harness?: string, extensions: {source: string, description?: string}[] }}
 */
export function parseManifest(raw, { path = "manifest", expectedHarness } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err.message}`);
  }

  const list = Array.isArray(parsed) ? parsed : parsed?.extensions;
  if (!Array.isArray(list)) {
    throw new Error(`${path} must be a JSON array or an object with an "extensions" array`);
  }

  const harness = typeof parsed?.harness === "string" ? parsed.harness : undefined;
  if (expectedHarness && harness && harness !== expectedHarness) {
    throw new Error(`${path} declares harness "${harness}" but is the "${expectedHarness}" manifest`);
  }

  const extensions = [];
  const seen = new Set();
  list.forEach((entry, index) => {
    const source = typeof entry === "string" ? entry : entry?.source;
    if (typeof source !== "string" || source.trim() === "") {
      throw new Error(`${path}: extension ${index} is missing a non-empty "source"`);
    }
    const normalized = source.trim();
    if (seen.has(normalized)) {
      throw new Error(`${path}: duplicate extension source "${normalized}"`);
    }
    seen.add(normalized);
    const description = typeof entry?.description === "string" ? entry.description : undefined;
    extensions.push(description === undefined ? { source: normalized } : { source: normalized, description });
  });

  return harness === undefined ? { extensions } : { harness, extensions };
}

/**
 * Plan the install for `extensions` against the sources already present in the
 * harness's local store. Order follows the manifest, so the plan (and a dry-run
 * report) is deterministic. A source is "already installed" when the store
 * carries the exact same source string — a pinned version bump therefore plans
 * a reinstall, while a repeat run at the same pin is a no-op.
 *
 * @param {{source: string, description?: string}[]} extensions
 * @param {Iterable<string>} installedSources
 * @returns {({source: string, description?: string, action: "install"|"skip"})[]}
 */
export function planInstalls(extensions, installedSources) {
  const installed = installedSources instanceof Set ? installedSources : new Set(installedSources);
  return extensions.map((entry) => ({ ...entry, action: installed.has(entry.source) ? "skip" : "install" }));
}

/**
 * Source strings declared in a pi `settings.json` `packages` array. Entries are
 * either a source string or an object with a `source` field (pi's object-form
 * package filter); anything else is ignored.
 *
 * @param {unknown} packages
 * @returns {string[]}
 */
export function packageSources(packages) {
  if (!Array.isArray(packages)) return [];
  return packages
    .map((entry) => (typeof entry === "string" ? entry : entry?.source))
    .filter((source) => typeof source === "string" && source !== "");
}
