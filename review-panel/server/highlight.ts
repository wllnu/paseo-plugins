import { highlightCode, isLanguageSupported } from "@getpaseo/highlight";
import type { DiffHunk, DiffLine } from "../shared/contracts";

/** Same cut-off as Paseo's own diff highlighter: minified or generated lines are not worth tokenizing. */
const MAX_LINE_CHARS = 10_000;
const MAX_FILE_CHARS = 2_000_000;

type Tokens = NonNullable<DiffLine["tokens"]>;
type Side = "old" | "new";

function lineOn(line: DiffLine, side: Side): number | null {
  return side === "old" ? line.oldLine : line.newLine;
}

/**
 * Merge neighbouring runs of one style, and fold whitespace into the run before it (spaces have no visible
 * color). The lezer output splits a lot, and every run is RPC payload on each poll.
 */
function compact(tokens: Tokens): Tokens {
  const merged: Tokens = [];
  for (const token of tokens) {
    if (!token.text) continue;
    const last = merged[merged.length - 1];
    if (last && (last.style === token.style || !token.text.trim())) last.text += token.text;
    else merged.push({ text: token.text, style: token.style });
  }
  return merged;
}

/**
 * Tokens by line number for one side of the diff. Tokenizing the whole file keeps multi-line constructs
 * (block comments, template strings) right; without the file, the side's diff lines are stitched together.
 */
function tokensBySide(hunks: readonly DiffHunk[], side: Side, content: string | null, file: string): Map<number, Tokens> {
  const numbered = hunks.flatMap((hunk) => hunk.lines).filter((line) => lineOn(line, side) !== null);
  const byLine = new Map<number, Tokens>();
  if (numbered.length === 0) return byLine;
  if (content !== null && content.length <= MAX_FILE_CHARS) {
    const lines = highlightCode(content.replace(/\r\n/g, "\n"), file);
    for (const line of numbered) {
      const number = lineOn(line, side)!;
      const tokens = lines[number - 1];
      if (tokens) byLine.set(number, tokens);
    }
    return byLine;
  }
  const lines = highlightCode(numbered.map((line) => line.text).join("\n"), file);
  numbered.forEach((line, index) => {
    const tokens = lines[index];
    if (tokens) byLine.set(lineOn(line, side)!, tokens);
  });
  return byLine;
}

/**
 * Attach syntax tokens to every diff line. Removed lines take the old file's tokens, the rest the new
 * file's. Highlighting is cosmetic: on any doubt (file changed since `git diff`, parser error) the line
 * stays plain.
 */
export function highlightHunks(
  hunks: DiffHunk[],
  file: string,
  sources: { old: string | null; new: string | null },
): DiffHunk[] {
  if (!isLanguageSupported(file)) return hunks;
  if (hunks.some((hunk) => hunk.lines.some((line) => line.text.length > MAX_LINE_CHARS))) return hunks;
  try {
    const oldTokens = tokensBySide(hunks, "old", sources.old, file);
    const newTokens = tokensBySide(hunks, "new", sources.new, file);
    return hunks.map((hunk) => ({
      ...hunk,
      lines: hunk.lines.map((line) => {
        const side: Side = line.kind === "del" ? "old" : "new";
        const raw = (side === "old" ? oldTokens : newTokens).get(lineOn(line, side) ?? -1);
        if (!raw) return line;
        const tokens = compact(raw);
        const matches = tokens.length > 0 && tokens.map((token) => token.text).join("") === line.text;
        return matches ? { ...line, tokens } : line;
      }),
    }));
  } catch {
    return hunks;
  }
}
