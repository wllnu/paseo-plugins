import { REVIEW_DIR, type Finding, type Review } from "./contracts";
import { SEVERITY_META, describeScope, formatLines } from "./findings";

export const FIX_PROMPT_TAG = "[review-panel fix]";

export interface FixPromptInput {
  reviewName: string;
  review: Review;
  /** Findings to fix, in the order they should be listed. */
  findings: readonly Finding[];
  /** Optional instructions the user typed in the send dialog. */
  note: string;
}

function pushBlock(lines: string[], label: string, text: string | null | undefined) {
  const body = text?.trim();
  if (!body) return;
  const [first, ...rest] = body.split(/\r?\n/);
  lines.push(`   ${label}: ${first ?? ""}`);
  const indent = " ".repeat(label.length + 5);
  for (const extra of rest) lines.push(`${indent}${extra}`);
}

/** The message sent to the agent: everything it needs to locate, fix, and report back on each finding. */
export function buildFixPrompt({ reviewName, review, findings, note }: FixPromptInput): string {
  const lines: string[] = [];
  const count = findings.length === 1 ? "1 finding" : `${findings.length} findings`;
  lines.push(`${FIX_PROMPT_TAG} Fix ${count} from the review "${review.title}".`);
  lines.push(`Review file: ${REVIEW_DIR}/${reviewName}`);
  lines.push(`Reviewed diff: ${describeScope(review.scope)}`);
  lines.push("");
  findings.forEach((finding, index) => {
    lines.push(`${index + 1}. ${finding.id} (${SEVERITY_META[finding.severity].label}): ${finding.title}`);
    if (finding.locations.length > 0) {
      const where = finding.locations
        .map((location) => {
          const notes = [location.side === "old" ? "removed lines, base version numbering" : null, location.note].filter(Boolean);
          return `${location.file}:${formatLines(location)}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
        })
        .join("; ");
      lines.push(`   Where: ${where}`);
    }
    pushBlock(lines, "Symptom", finding.symptom);
    pushBlock(lines, "Detail", finding.detail);
    pushBlock(lines, "Fix", finding.fix);
    lines.push("");
  });
  const trimmedNote = note.trim();
  if (trimmedNote) {
    lines.push("Note from me:");
    lines.push(trimmedNote);
    lines.push("");
  }
  lines.push(
    "Verify each finding against the current code before changing it. If you disagree with one, do not change the code for it; mark it wont-fix and say why. Fix the rest, run the relevant tests, then set \"resolution\" on each finding in the review file ({\"status\": \"fixed\" | \"wont-fix\", \"note\": \"...\"}) and reply with one line per id.",
  );
  return lines.join("\n");
}
