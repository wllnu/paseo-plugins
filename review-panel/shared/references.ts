/** A run of finding text: plain text, or a `path:line` reference the panel turns into a diff link. */
export type TextPart =
  | { kind: "text"; text: string }
  | { kind: "ref"; text: string; file: string; line: number; endLine: number | null };

// path/with/dirs.ext:12 or file.ext:12-20. The leading group keeps the match off the middle of a word or URL
// without a lookbehind, which older Hermes builds do not support.
const REFERENCE = /(^|[^\w/.@-])((?:[\w@.-]+\/)*[\w@-][\w@.-]*\.[A-Za-z][A-Za-z0-9]{0,9}):(\d+)(?:\s?[-–]\s?(\d+))?/g;

/**
 * Split text into plain runs and code references. A bare file name such as `retry.ts:42` resolves to the
 * one known path that ends with it, so short references in prose still open the right file.
 */
export function splitReferences(text: string, knownFiles: readonly string[]): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(REFERENCE)) {
    const [whole, lead, rawFile, rawLine, rawEnd] = match;
    if (!rawFile || !rawLine) continue;
    const start = (match.index ?? 0) + (lead?.length ?? 0);
    if (start > cursor) parts.push({ kind: "text", text: text.slice(cursor, start) });
    const line = Number(rawLine);
    const end = rawEnd ? Number(rawEnd) : null;
    parts.push({
      kind: "ref",
      text: whole.slice(lead?.length ?? 0),
      file: resolveFile(rawFile, knownFiles),
      line,
      endLine: end !== null && end > line ? end : null,
    });
    cursor = (match.index ?? 0) + whole.length;
  }
  if (cursor < text.length) parts.push({ kind: "text", text: text.slice(cursor) });
  return parts;
}

function resolveFile(file: string, knownFiles: readonly string[]): string {
  const clean = file.replace(/^\.\//, "");
  if (knownFiles.includes(clean)) return clean;
  const matches = knownFiles.filter((known) => known.endsWith(`/${clean}`));
  return matches.length === 1 && matches[0] ? matches[0] : clean;
}
