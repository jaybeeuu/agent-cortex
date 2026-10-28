// Verify that a dispatched pipeline-stage worker actually delivered.
//
// Why this exists: a worker's `---REPORT---` is a claim, not evidence. A stage
// that reports `OUTCOME: SUCCESS` and leaves its work uncommitted looks
// identical, from the report alone, to one that committed and pushed — and the
// orchestrator opens the feature PR from the branch, so uncommitted work is
// silently dropped. The observed failure was exactly that: workers reporting
// success with a dirty worktree, every one of them needing a human to finish
// the tree by hand.
//
// This module answers one question against the worktree itself: did this worker
// leave a clean tree with at least one commit ahead of where it started? It
// reads nothing the worker wrote, so it cannot be fooled by the worker's prose.
//
// Usage (CLI):
//   node scripts/lib/verify-worker-tree.mjs --worktree <dir> --base <sha>
//   node scripts/lib/verify-worker-tree.mjs --worktree <dir> --base <ref> --json
//
// Exit code is 0 only when the worker delivered, so a caller can gate on it.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SELF = fileURLToPath(import.meta.url);

async function git(worktree, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: worktree });
  return stdout.trim();
}

function countPaths(porcelain) {
  return porcelain.split("\n").filter((line) => line.trim() !== "").length;
}

/**
 * Check that a worker delivered: clean worktree and at least one commit ahead
 * of `base`. Returns the reasons it failed, so the caller can surface them
 * instead of guessing why a stage did not advance.
 */
export async function verifyWorkerTree({ worktree, base }) {
  const reasons = [];

  const dirty = await git(worktree, ["status", "--porcelain"]);
  if (dirty !== "") {
    reasons.push(`worktree is dirty: ${countPaths(dirty)} uncommitted path(s)`);
  }

  const ahead = Number(await git(worktree, ["rev-list", "--count", `${base}..HEAD`]));
  if (!Number.isFinite(ahead) || ahead < 1) {
    reasons.push(`no commit ahead of base ${base.slice(0, 7)}`);
  }

  return { ok: reasons.length === 0, reasons, commitsAhead: ahead };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

function required(flags, name) {
  const value = flags[name];
  if (typeof value !== "string" || value === "") {
    console.error(`verify-worker-tree: --${name} <value> is required`);
    process.exit(2);
  }
  return value;
}

async function main(argv) {
  const flags = parseFlags(argv);
  const verdict = await verifyWorkerTree({
    worktree: required(flags, "worktree"),
    base: required(flags, "base"),
  });

  if (flags.json) {
    console.log(JSON.stringify(verdict, null, 2));
  } else if (verdict.ok) {
    console.log(`ok: ${verdict.commitsAhead} commit(s) ahead of base, tree clean`);
  } else {
    for (const reason of verdict.reasons) console.error(`failed: ${reason}`);
  }

  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  await main(process.argv.slice(2));
}
