// ── Rendering helpers ────────────────────────────────────────────────────────

export function formatTable(header: string[], rows: string[][]): string {
  const colWidths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const sep = "─".repeat(Math.max(1, colWidths.reduce((a, b) => a + b + 3, 1) - 1));

  const fmtRow = (cells: string[]) =>
    " " + cells.map((c, i) => c.padEnd(colWidths[i])).join(" │ ");

  return [fmtRow(header), sep, ...rows.map(fmtRow)].join("\n");
}
