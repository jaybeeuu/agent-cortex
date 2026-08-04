/**
 * Context file loader for session-start extension.
 *
 * Reads project context files (AGENTS.md, user-preferences.md, etc.) and
 * formats them for injection into the agent session at startup.
 */

import fs from "node:fs";
import path from "node:path";

export interface ContextFile {
  path: string;
  content: string;
}

/**
 * Default context files to load at session start.
 * Paths are relative to the project root (cwd).
 */
export const DEFAULT_CONTEXT_FILES = [
  "AGENTS.md",
  "docs/user-preferences.md",
];

/**
 * Load a single context file. Returns null if the file doesn't exist or is empty.
 */
export function loadContextFile(filePath: string): ContextFile | null {
  if (!filePath) return null;

  try {
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return null;
    return { path: filePath, content };
  } catch {
    return null;
  }
}

/**
 * Load all context files from the given paths (relative to cwd).
 * Returns a formatted string ready for injection into the session.
 */
export function loadSessionContext(
  cwd: string,
  filePaths?: string[],
): string {
  const files = filePaths ?? DEFAULT_CONTEXT_FILES;
  const loaded: ContextFile[] = [];

  for (const relPath of files) {
    const absPath = path.resolve(cwd, relPath);
    const file = loadContextFile(absPath);
    if (file) loaded.push(file);
  }

  if (loaded.length === 0) return "";

  return loaded
    .map((f) => {
      const name = path.basename(f.path);
      return `--- ${name} ---\n${f.content}`;
    })
    .join("\n\n");
}
