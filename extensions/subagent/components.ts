/**
 * Transcript components for the subagent tool's renderers.
 *
 * pi-tui's `Text`, `Container` and `Spacer` are not reachable from an installed
 * extension: a value import of `@earendil-works/pi-tui` makes the extension fail
 * to load outside the agent-cortex checkout (test/pi-extensions-load.test.mjs).
 * These are the local equivalents, implementing the `Component` contract pi's
 * transcript renderer calls: `render(width)` returns lines that fit `width`, and
 * `invalidate()` drops cached layout.
 *
 * Two deliberate limits, because reimplementing pi-tui is not this change:
 * markdown is drawn as plain text, and only SGR colour sequences (`ESC[…m`) are
 * measured and carried across a wrapped line. Other escapes — OSC-8 hyperlinks,
 * images — count as visible characters, the same way a naive strip does.
 * Width is measured in terminal cells: a wide (East Asian) character, and any
 * astral character such as an emoji, counts as two.
 */

/** Lines to draw at a given width — what pi's transcript renderer calls. */
export interface Component {
  render(width: number): string[];
  invalidate(): void;
}

const SGR = /\x1b\[[0-9;]*m/g;
const SGR_AT = /\x1b\[[0-9;]*m/y;
const RESET = "\x1b[0m";

/** A block of text, word-wrapped to the width it is drawn at. */
export class Text implements Component {
  readonly #text: string;
  readonly #paddingX: number;
  readonly #paddingY: number;

  constructor(text = "", paddingX = 0, paddingY = 0) {
    this.#text = text;
    this.#paddingX = paddingX;
    this.#paddingY = paddingY;
  }

  render(width: number): string[] {
    const available = Math.max(1, width - this.#paddingX * 2);
    const indent = " ".repeat(this.#paddingX);
    const blank = indent.repeat(2);
    const body = this.#text.split("\n").flatMap((line) => wrapLine(line, available));

    return [
      ...emptyLines(this.#paddingY, blank),
      ...body.map((line) => `${indent}${line}${indent}`),
      ...emptyLines(this.#paddingY, blank),
    ];
  }

  invalidate(): void {}
}

/** Blank lines. */
export class Spacer implements Component {
  readonly #lines: number;

  constructor(lines = 1) {
    this.#lines = lines;
  }

  render(_width: number): string[] {
    return emptyLines(this.#lines, "");
  }

  invalidate(): void {}
}

/** A vertical stack of components. */
export class Container implements Component {
  readonly #children: Component[] = [];

  addChild(child: Component): void {
    this.#children.push(child);
  }

  render(width: number): string[] {
    return this.#children.flatMap((child) => child.render(width));
  }

  invalidate(): void {
    for (const child of this.#children) child.invalidate();
  }
}

/** `count` blank lines, each filled with `filler` (padding keeps the width). */
function emptyLines(count: number, filler: string): string[] {
  return Array.from({ length: Math.max(0, count) }, () => filler);
}

/** Visible cell count of a line: everything except SGR sequences, wide characters as two. */
function visibleWidth(line: string): number {
  let cells = 0;
  for (const character of line.replace(SGR, "")) cells += cellWidth(character.codePointAt(0) ?? 0);
  return cells;
}

/**
 * Terminal cells one character occupies. Wide East Asian characters and astral
 * characters (emoji included) occupy two; every other character occupies one.
 * Counting in `String.length` units would let a wide character overflow: it is
 * one unit but two cells.
 */
function cellWidth(codePoint: number): number {
  if (codePoint > 0xffff) return 2;
  return codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6))
    ? 2
    : 1;
}

/**
 * Wrap one line to `width` visible columns without cutting an SGR sequence. A
 * cut inside a coloured span closes the line and reopens the same colour on the
 * continuation, so broken escapes never reach the terminal.
 */
function wrapLine(line: string, width: number): string[] {
  const lines: string[] = [];
  let rest = line;

  while (visibleWidth(rest) > width) {
    const cut = breakIndex(rest, width);
    if (cut <= 0) break;

    const head = rest.slice(0, cut);
    const colour = lastColour(head);
    lines.push(colour === "" ? head : `${head}${RESET}`);
    // A break taken at a space consumes it, so the continuation starts with its word.
    rest = `${colour}${rest.slice(rest[cut] === " " ? cut + 1 : cut)}`;
  }

  lines.push(rest);
  return lines;
}

/**
 * Index at which to cut `text` so its visible width stays within `width`:
 * the last space at or before the limit, or the limit itself when the line has
 * no usable space.
 */
function breakIndex(text: string, width: number): number {
  let visible = 0;
  let lastSpace = -1;
  let index = 0;

  while (index < text.length) {
    SGR_AT.lastIndex = index;
    const escape = SGR_AT.exec(text);
    if (escape !== null) {
      index += escape[0].length;
      continue;
    }

    const codePoint = text.codePointAt(index) ?? 0;
    const character = String.fromCodePoint(codePoint);
    if (character === " ") lastSpace = index;
    if (visible + cellWidth(codePoint) > width) return lastSpace > 0 ? lastSpace : index;

    visible += cellWidth(codePoint);
    index += character.length;
  }

  return lastSpace > 0 ? lastSpace : index;
}

/** The colour sequence left open at the end of `text`, or "" when none is. */
function lastColour(text: string): string {
  let colour = "";
  for (const [sequence] of text.matchAll(SGR)) {
    colour = sequence === RESET || sequence === "\x1b[m" ? "" : sequence;
  }
  return colour;
}
