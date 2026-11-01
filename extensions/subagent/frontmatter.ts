/**
 * Read the YAML frontmatter block of a markdown document.
 *
 * pi's own `parseFrontmatter` is not reachable from an installed extension: a
 * value import of `@earendil-works/pi-coding-agent` makes the extension fail to
 * load outside the agent-cortex checkout (test/pi-extensions-load.test.mjs).
 * This module is the subset agent files use — top-level `key: value` pairs,
 * plain and quoted scalars, flow sequences (`[a, b]`) and block sequences
 * (`- a`).
 *
 * Deliberately outside the subset: nested maps and block scalars (`|`, `>`) keep
 * their literal text as the value. No construct throws — an unreadable block
 * yields empty frontmatter — so one malformed agent file cannot break discovery
 * of the others.
 */

/** A parsed document: its frontmatter fields and the markdown body. */
export interface ParsedFrontmatter<T extends Record<string, unknown>> {
  frontmatter: T;
  body: string;
}

const FENCE = "---";

/**
 * Split a markdown document into frontmatter fields and body, matching pi's
 * contract: the document must open with `---` and close the block with a line
 * that starts with `---`; the body is trimmed.
 */
export function parseFrontmatter<T extends Record<string, unknown>>(content: string): ParsedFrontmatter<T> {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const end = normalized.startsWith(FENCE) ? normalized.indexOf(`\n${FENCE}`, FENCE.length) : -1;
  if (end === -1) return { frontmatter: {} as T, body: normalized };

  return {
    frontmatter: parseBlock(normalized.slice(FENCE.length + 1, end)) as T,
    body: normalized.slice(end + FENCE.length + 1).trim(),
  };
}

/** Parse the `key: value` lines of a frontmatter block. */
function parseBlock(block: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const lines = block.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const match = /^([\w.-]+):(?:[ \t]+(.*))?$/.exec(lines[index]);
    if (match === null) continue;

    const [, key, inlineValue] = match;
    if (inlineValue !== undefined && inlineValue.trim() !== "") {
      fields[key] = parseValue(inlineValue.trim());
      continue;
    }

    const { items, consumed } = readBlockSequence(lines, index + 1);
    index += consumed;
    fields[key] = items.length > 0 ? items : null;
  }

  return fields;
}

/**
 * Read the indented `- item` lines that follow a `key:` line with no inline
 * value. Returns the items and how many lines were consumed.
 */
function readBlockSequence(lines: string[], start: number): { items: string[]; consumed: number } {
  const items: string[] = [];
  let consumed = 0;

  for (let index = start; index < lines.length; index++) {
    const match = /^[ \t]+-[ \t]+(.*)$/.exec(lines[index]);
    if (match === null) break;

    const value = parseValue(match[1].trim());
    items.push(typeof value === "string" ? value : String(value));
    consumed++;
  }

  return { items, consumed };
}

/** Parse one scalar or flow sequence. */
function parseValue(raw: string): unknown {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map(parseValue);
  }
  if (raw.startsWith('"')) return unquote(raw, '"', (text) => text.replace(/\\(["\\/nrt])/g, (_, escape: string) => {
    return escape === "n" ? "\n" : escape === "r" ? "\r" : escape === "t" ? "\t" : escape;
  }));
  if (raw.startsWith("'")) return unquote(raw, "'", (text) => text.replace(/''/g, "'"));
  return raw;
}

/** Strip a matching quote pair and unescape the content; an unterminated quote keeps the raw text. */
function unquote(raw: string, quote: string, unescape: (text: string) => string): string {
  if (raw.length < 2 || !raw.endsWith(quote)) return raw;
  return unescape(raw.slice(1, -1));
}
