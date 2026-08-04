import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Frontmatter {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  argumentHint?: string;
  [key: string]: unknown;
}

export interface AgentDir {
  name: string;
  agentMdPath: string;
  harnesses: Map<string, { frontmatter: Frontmatter; sections: string[] }>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUIRED_FIELDS = ["name", "description", "tools"] as const;
const KNOWN_OPTIONAL_FIELDS = ["model", "argumentHint"] as const;

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateFrontmatter(fm: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof fm !== "object" || fm === null) {
    return { ok: false, errors: ["frontmatter must be an object"] };
  }

  const record = fm as Record<string, unknown>;

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in record)) {
      errors.push(`missing required field: ${field}`);
    }
  }

  // Validate name
  if (typeof record.name === "string" && record.name.trim() === "") {
    errors.push("name must not be empty");
  }

  // Validate description
  if (typeof record.description === "string" && record.description.trim() === "") {
    errors.push("description must not be empty");
  }

  // Validate tools
  if ("tools" in record) {
    if (!Array.isArray(record.tools)) {
      errors.push("tools must be an array");
    } else if (record.tools.length === 0) {
      errors.push("tools must not be empty");
    } else if (!record.tools.every((t) => typeof t === "string")) {
      errors.push("tools must be an array of strings");
    }
  }

  // Check for unknown fields
  const knownFields = new Set([...REQUIRED_FIELDS, ...KNOWN_OPTIONAL_FIELDS]);
  for (const key of Object.keys(record)) {
    if (!knownFields.has(key as any)) {
      errors.push(`unknown field: ${key}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateAgentDir(agentDirPath: string): ValidationResult {
  const errors: string[] = [];

  // Check agent.md exists
  const agentMdPath = join(agentDirPath, "agent.md");
  if (!existsSync(agentMdPath)) {
    errors.push("missing agent.md");
  }

  // Check for at least one harness subdirectory with frontmatter.json
  if (!existsSync(agentDirPath)) {
    return { ok: false, errors: ["agent directory does not exist"] };
  }

  const entries = readdirSync(agentDirPath);
  const harnessDirs = entries.filter((entry) => {
    const fullPath = join(agentDirPath, entry);
    return statSync(fullPath).isDirectory() && entry !== "node_modules";
  });

  if (harnessDirs.length === 0) {
    errors.push("no harness subdirectories found (need at least one with frontmatter.json)");
  }

  // Validate each harness directory
  for (const harnessDir of harnessDirs) {
    const frontmatterPath = join(agentDirPath, harnessDir, "frontmatter.json");
    if (!existsSync(frontmatterPath)) {
      continue; // Skip directories without frontmatter.json
    }

    try {
      const content = readFileSync(frontmatterPath, "utf-8");
      const fm = JSON.parse(content);
      const result = validateFrontmatter(fm);
      if (!result.ok) {
        for (const err of result.errors) {
          errors.push(`${harnessDir}/frontmatter.json: ${err}`);
        }
      }
    } catch (e) {
      errors.push(`${harnessDir}/frontmatter.json: invalid JSON`);
    }
  }

  return { ok: errors.length === 0, errors };
}
