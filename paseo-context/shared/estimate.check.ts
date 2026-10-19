// Run: node --experimental-strip-types shared/estimate.check.ts
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { allocateCells, estimateContext } from "./estimate.ts";

declare const console: { log(message: string): void };

function equal(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const read = (filePath: string, content: string): AgentTimelineItem => ({
  type: "tool_call",
  callId: filePath,
  name: "Read",
  status: "completed",
  error: null,
  detail: { type: "read", filePath, content },
});

const items: AgentTimelineItem[] = [
  { type: "user_message", text: "x".repeat(4000) },
  { type: "compaction", status: "completed" },
  { type: "user_message", text: "x".repeat(40) },
  read("/repo/big.sql", "x".repeat(400)),
  { type: "assistant_message", text: "x".repeat(80) },
  { type: "todo", items: [{ text: "ignored", completed: false }] },
];

const estimate = estimateContext(items);
equal(estimate.compacted, true, "compacted");
equal(estimate.total, 130, "total skips items before the compaction and UI-only rows");
equal(
  estimate.categories.map(({ category, tokens }) => ({ category, tokens })),
  [
    { category: "reads", tokens: 100 },
    { category: "assistant", tokens: 20 },
    { category: "user", tokens: 10 },
  ],
  "categories sorted largest first",
);
equal(estimate.categories[0].items[0].title, "Read /repo/big.sql", "items keep a title");
equal(allocateCells([50, 30, 20], 200, 100), [25, 15, 10], "cells follow share of the window");
equal(allocateCells([1, 1, 1], 3, 100), [34, 33, 33], "remainders fill the grid exactly");
equal(allocateCells([150], 100, 100), [100], "an overfull window is capped at the grid");
equal(allocateCells([5], 0, 100), [0], "no total, no cells");
equal(estimateContext([]).total, 0, "empty timeline");
equal(
  estimateContext([{ type: "compaction", status: "loading" }, ...items.slice(0, 1)]).compacted,
  false,
  "a compaction still loading does not hide earlier items",
);
console.log("estimate checks passed");
