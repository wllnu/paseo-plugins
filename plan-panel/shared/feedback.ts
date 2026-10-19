import type { PlanComment, PlanLocator, PlanLocatorBase } from "./contracts";
import { PLAN_DIR } from "./contracts";

const BLOCK_LABELS: Record<string, string> = {
  p: "paragraph",
  li: "list item",
  pre: "code block",
  tr: "table row",
  summary: "summary",
  dt: "entry",
  blockquote: "quote",
  aside: "callout",
  "ul.facts": "fact chips",
  "ol.flow": "flow",
  h1: "title",
  h2: "section heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  selection: "highlighted text",
};

/** Location of one block: heading breadcrumb, kind, position, and id. */
export function describeBlock(locator: PlanLocatorBase): string {
  const parts: string[] = [];
  if (locator.headings.length > 0) parts.push(locator.headings.map((heading) => `"${heading}"`).join(" › "));
  const label = BLOCK_LABELS[locator.tag] ?? locator.tag;
  const isHeading = locator.tag.startsWith("h") && locator.tag.length === 2;
  const position = isHeading || locator.tag === "selection" ? label : `${label} ${locator.ordinal}`;
  const id = locator.elementId ?? (locator.anchorId ? `inside #${locator.anchorId}` : null);
  parts.push(id ? `${position} (${locator.elementId ? "#" : ""}${id})` : position);
  return parts.join(" › ");
}

/** Every block a comment targets, in document order. */
export function locatorBlocks(locator: PlanLocator): PlanLocatorBase[] {
  return [locator, ...locator.others];
}

/** One-line, human-readable description of where a comment sits. */
export function describeLocator(locator: PlanLocator | null): string {
  if (!locator) return "whole plan (general comment)";
  const start = describeBlock(locator);
  if (locator.end && locator.end.key !== locator.key) return `from ${start} to ${describeBlock(locator.end)}`;
  const more = locator.others.length;
  if (more > 0) return `${start} and ${more} more block${more === 1 ? "" : "s"}`;
  return start;
}

const MAX_SELECTED_TEXT = 1000;

function quoteFor(locator: PlanLocator): { label: string; text: string } | null {
  if (locator.selectedText && locator.selectedText.trim().length > 0) {
    const text = locator.selectedText.trim();
    return { label: "Selected", text: text.length > MAX_SELECTED_TEXT ? `${text.slice(0, MAX_SELECTED_TEXT - 1)}…` : text };
  }
  if (locator.excerpt) return { label: "Quote", text: locator.excerpt };
  return null;
}

export interface FeedbackPromptInput {
  planName: string;
  planTitle: string;
  revision: string | null;
  /** A roadmap is markdown and must keep the Status lines of its work packages. */
  kind?: "plan" | "roadmap";
  comments: readonly PlanComment[];
}

/** The message sent to the agent. Everything the agent needs to find and address each comment. */
export function buildFeedbackPrompt({ planName, planTitle, revision, kind = "plan", comments }: FeedbackPromptInput): string {
  const lines: string[] = [];
  const revisionLabel = revision ? ` (revision ${revision})` : "";
  lines.push(`[plan-panel feedback] Feedback on the ${kind} "${planTitle}"${revisionLabel}.`);
  lines.push(`${kind === "roadmap" ? "Roadmap" : "Plan"} file: ${PLAN_DIR}/${planName}`);
  lines.push("");
  lines.push(
    comments.length === 1
      ? "I left 1 comment in the plan panel. It names the blocks I selected, or the text I highlighted."
      : `I left ${comments.length} comments in the plan panel. Each one names the blocks I selected, or the text I highlighted.`,
  );
  lines.push("");
  comments.forEach((comment, index) => {
    const locator = comment.locator;
    if (locator && locator.others.length > 0) {
      // One comment on several blocks: list each with its quote, so the agent can find all of them.
      const blocks = locatorBlocks(locator);
      lines.push(`${index + 1}. Where: ${blocks.length} blocks`);
      for (const block of blocks) {
        lines.push(`   - ${describeBlock(block)}${block.excerpt ? `: "${block.excerpt}"` : ""}`);
      }
    } else {
      lines.push(`${index + 1}. Where: ${describeLocator(locator)}`);
      const quote = locator ? quoteFor(locator) : null;
      if (quote) lines.push(`   ${quote.label}: "${quote.text}"`);
    }
    const text = comment.text.trim().split(/\r?\n/);
    lines.push(`   Comment: ${text[0] ?? ""}`);
    for (const extra of text.slice(1)) lines.push(`            ${extra}`);
    lines.push("");
  });
  lines.push(
    kind === "roadmap"
      ? "Please refine the roadmap: address every comment, update the markdown file in place, keep package ids stable, and keep the Status lines of packages you do not change. Then reply with a short summary of what changed per comment. If a comment is ambiguous, ask me before changing the roadmap."
      : "Please refine the plan: address every comment, update the HTML plan file in place, keep existing element ids stable, bump the plan-revision meta, and mark changed elements with data-revised=\"<new revision>\". Then reply with a short summary of what changed per comment. If a comment is ambiguous, ask me before changing the plan.",
  );
  return lines.join("\n");
}
