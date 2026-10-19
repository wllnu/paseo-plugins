import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export type Category =
  | "user"
  | "assistant"
  | "reasoning"
  | "reads"
  | "shell"
  | "search"
  | "web"
  | "edits"
  | "subagents"
  | "tools";

export const CATEGORY_LABELS: Record<Category, string> = {
  user: "Your messages",
  assistant: "Agent replies",
  reasoning: "Reasoning",
  reads: "File reads",
  shell: "Shell commands",
  search: "Searches",
  web: "Web fetches",
  edits: "Edits and writes",
  subagents: "Subagents",
  tools: "Other tools",
};

/** One thing in the context: a message, a tool call, a prompt section, a file. */
export interface ContextItem {
  title: string;
  text: string;
  tokens: number;
}

export interface ContextEstimate {
  total: number;
  /** Largest category first; items largest first within each. */
  categories: { category: Category; tokens: number; items: ContextItem[] }[];
  /** True when a completed compaction was found, so earlier items were left out. */
  compacted: boolean;
}

// lazy: 4 characters per token is the usual rough ratio for English and code, not a tokenizer.
// Upgrade path: count with the provider's tokenizer in a server RPC.
export function estimateTokens(characters: number) {
  return Math.ceil(characters / 4);
}

export function formatTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

export function formatShare(share: number) {
  return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

export function firstLine(text: string) {
  return (text.trim().split("\n")[0] ?? "").slice(0, 120);
}

export function sumTokens(entries: readonly { tokens: number }[]) {
  return entries.reduce((sum, entry) => sum + entry.tokens, 0);
}

function join(...parts: (string | undefined)[]) {
  return parts.filter(Boolean).join("\n");
}

function json(value: unknown) {
  return value == null ? "" : JSON.stringify(value);
}

function measure(
  item: AgentTimelineItem,
): { category: Category; title: string; text: string } | null {
  switch (item.type) {
    case "user_message":
      return { category: "user", title: item.text, text: item.text };
    case "assistant_message":
      return { category: "assistant", title: item.text, text: item.text };
    case "reasoning":
      return { category: "reasoning", title: item.text, text: item.text };
    case "tool_call": {
      const { detail } = item;
      switch (detail.type) {
        case "read":
          return { category: "reads", title: `Read ${detail.filePath}`, text: detail.content ?? "" };
        case "shell":
          return {
            category: "shell",
            title: detail.command,
            text: join(detail.command, detail.output),
          };
        case "search":
          return {
            category: "search",
            title: `Search ${detail.query}`,
            text: join(detail.query, detail.content, detail.filePaths?.join("\n")),
          };
        case "fetch":
          return {
            category: "web",
            title: `Fetch ${detail.url}`,
            text: join(detail.url, detail.prompt, detail.result),
          };
        case "edit":
          return {
            category: "edits",
            title: `Edit ${detail.filePath}`,
            text: detail.unifiedDiff ?? join(detail.oldString, detail.newString),
          };
        case "write":
          return {
            category: "edits",
            title: `Write ${detail.filePath}`,
            text: detail.content ?? "",
          };
        case "sub_agent":
          return {
            category: "subagents",
            title: detail.description ?? detail.subAgentType ?? item.name,
            text: detail.log,
          };
        case "plan":
          return { category: "tools", title: "Plan", text: detail.text };
        case "plain_text":
          return { category: "tools", title: detail.label ?? item.name, text: detail.text ?? "" };
        case "worktree_setup":
          // Paseo runs worktree setup; its log never reaches the model.
          return null;
        default:
          return {
            category: "tools",
            title: item.name,
            text: join(json(detail.input), json(detail.output)),
          };
      }
    }
    default:
      // Todos, errors, notifications, compaction markers and plugin rows are Paseo UI, not model context.
      return null;
  }
}

export function estimateContext(items: readonly AgentTimelineItem[]): ContextEstimate {
  // A completed compaction replaces everything before it with a summary, so only later items count.
  let start = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type === "compaction" && item.status === "completed") {
      start = i + 1;
      break;
    }
  }

  const byCategory = new Map<Category, ContextItem[]>();
  for (let index = start; index < items.length; index++) {
    const result = measure(items[index]);
    if (!result) continue;
    const tokens = estimateTokens(result.text.length);
    if (tokens === 0) continue;
    const list = byCategory.get(result.category) ?? [];
    list.push({ title: firstLine(result.title), text: result.text, tokens });
    byCategory.set(result.category, list);
  }

  const categories = [...byCategory]
    .map(([category, list]) => ({
      category,
      tokens: sumTokens(list),
      items: list.sort((a, b) => b.tokens - a.tokens),
    }))
    .sort((a, b) => b.tokens - a.tokens);
  return {
    total: sumTokens(categories),
    categories,
    compacted: start > 0,
  };
}

// Splits `cells` grid cells between values in proportion to their share of `total`
// (largest remainder), so the grid never shows more filled cells than the values cover.
export function allocateCells(values: readonly number[], total: number, cells: number) {
  if (total <= 0) return values.map(() => 0);
  // Estimates can add up to more than the window; then they share the whole grid.
  const scale = Math.max(
    total,
    values.reduce((sum, value) => sum + Math.max(value, 0), 0),
  );
  const exact = values.map((value) => (Math.max(value, 0) / scale) * cells);
  const counts = exact.map(Math.floor);
  const target = Math.min(cells, Math.round(exact.reduce((sum, value) => sum + value, 0)));
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  let assigned = counts.reduce((sum, count) => sum + count, 0);
  for (const { index } of byRemainder) {
    if (assigned >= target) break;
    counts[index]++;
    assigned++;
  }
  return counts;
}
