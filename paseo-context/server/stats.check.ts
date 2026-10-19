import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { countActivity } from "../shared/stats.ts";
import { UNACCOUNTED, buildTrends, turnCosts } from "../shared/trends.ts";
import { parseRecords } from "./stats.ts";

function equal(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const call = (callId: string, name: string): AgentTimelineItem => ({
  type: "tool_call",
  callId,
  name,
  status: "completed",
  error: null,
  detail: { type: "plain_text", text: "" },
});

equal(
  countActivity([
    { type: "user_message", text: "a" },
    call("1", "Bash"),
    call("1", "Bash"),
    { type: "compaction", status: "completed" },
    { type: "user_message", text: "b" },
    call("2", "Read"),
    call("3", "Bash"),
  ]),
  { turns: 2, toolCalls: 3, toolCallsByName: { Bash: 2, Read: 1 } },
  "counts span compactions and dedupe by callId",
);

const record = (
  agentId: string,
  workspaceId: string | null,
  parentAgentId: string | null,
  extra: object = {},
) => ({
  at: "2026-10-14T10:00:00.000Z",
  agentId,
  parentAgentId,
  workspaceId,
  title: null,
  cwd: "/repo",
  provider: "claude",
  model: null,
  turnId: null,
  outcome: "completed",
  turns: 1,
  toolCalls: 0,
  toolCallsByName: {},
  usage: null,
  categories: {},
  fixed: {},
  compacted: false,
  ...extra,
});

const text = [
  JSON.stringify(record("a", "w1", null)),
  "{torn",
  JSON.stringify({ agentId: "missing fields" }),
  JSON.stringify(record("sub", null, "a")),
  JSON.stringify(record("b", "w2", null)),
  "",
].join("\n");

const records = parseRecords(text);
equal(records.length, 3, "bad lines are skipped");

const used = (tokens: number) => ({ usage: { contextWindowUsedTokens: tokens } });
const trendRecords = parseRecords(
  [
    // Agent a: two turns; only the second counts for days.
    record("a", "w", null, { model: "opus", turns: 1, categories: { reads: 10 }, ...used(100) }),
    record("a", "w", null, { model: "opus", turns: 4, categories: { reads: 50 }, ...used(100) }),
    record("b", "w", null, { model: "opus", turns: 2, categories: { reads: 30 }, ...used(100) }),
    // No reported usage: share falls back to everything measured.
    record("c", "w", null, {
      model: "haiku",
      at: "2026-10-12T10:00:00.000Z",
      turns: 1,
      categories: { reads: 20, shell: 60 },
      fixed: { "System prompt": 20 },
    }),
  ]
    .map((r) => JSON.stringify(r))
    .join("\n"),
);
const days = buildTrends(trendRecords, { category: null, measure: "share", axis: "day" });
equal(days.category, "reads", "file reads is the default category");
equal(
  days.categories,
  [UNACCOUNTED, "reads", "shell", "System prompt"],
  "categories largest first",
);
equal(days.buckets.length, 3, "empty days in between still get a bucket");
equal(
  days.series.map((s) => [s.model, s.sessions, s.average, s.points.map((p) => p?.value ?? null)]),
  [
    ["opus", 2, 0.4, [null, null, 0.4]],
    ["haiku", 1, 0.2, [0.2, null, null]],
  ],
  "days average each session's latest share, highest model first",
);
equal(
  days.summary,
  { sessions: 3, turns: 4, since: "2026-10-14T10:00:00.000Z", costUsd: 0 },
  "summary",
);
equal(days.costs, [], "models without reported cost get no cost series");
equal(
  days.makeup,
  {
    models: ["opus", "haiku"],
    rows: [
      { category: UNACCOUNTED, values: [0.6, 0] },
      { category: "reads", values: [0.4, 0.2] },
      { category: "shell", values: [0, 0.6] },
      { category: "System prompt", values: [0, 0.2] },
    ],
  },
  "make-up averages each category per model",
);
const turns = buildTrends(trendRecords, { category: "reads", measure: "tokens", axis: "turn" });
equal(turns.buckets, ["1", "2–3", "4–7"], "turn buckets double in width");
equal(
  turns.series.find((s) => s.model === "opus")?.points,
  [
    { value: 10, count: 1 },
    { value: 30, count: 1 },
    { value: 50, count: 1 },
  ],
  "turn axis counts every turn record",
);
equal(buildTrends([], { category: null, measure: "share", axis: "week" }).series, [], "no data");

const cost = (agentId: string, at: string, turns: number, totalCostUsd: number) =>
  record(agentId, "w", null, { model: "opus", at, turns, usage: { totalCostUsd } });
const costRecords = parseRecords(
  [
    cost("x", "2026-10-13T10:00:00.000Z", 1, 1),
    cost("y", "2026-10-13T11:00:00.000Z", 1, 2),
    cost("x", "2026-10-14T10:00:00.000Z", 2, 3),
    // The session reopened and its running total started over.
    cost("x", "2026-10-14T11:00:00.000Z", 3, 0.5),
  ]
    .map((r) => JSON.stringify(r))
    .join("\n"),
);
equal(turnCosts(costRecords), [1, 2, 2, 0.5], "turn cost is the running total's increase");
const costDays = buildTrends(costRecords, { category: null, measure: "share", axis: "day" });
equal(costDays.summary.costUsd, 5.5, "total cost");
equal(
  costDays.costs,
  [
    {
      model: "opus",
      sessions: 2,
      totalUsd: 5.5,
      perSessionUsd: 2.75,
      points: [
        { value: 3, count: 2 },
        { value: 2.5, count: 2 },
      ],
    },
  ],
  "days sum the cost of turns that ended in them",
);
equal(
  buildTrends(costRecords, { category: null, measure: "share", axis: "turn" }).costs[0].points,
  [
    { value: 1.5, count: 2 },
    { value: 1.25, count: 2 },
  ],
  "turn number averages the cost of one turn",
);

// Turn cost $2 over a 100-token context: reads hold 25, shell 25, the rest is unexplained.
const split = parseRecords(
  JSON.stringify(
    record("z", "w", null, {
      model: "opus",
      categories: { reads: 25, shell: 25 },
      usage: { contextWindowUsedTokens: 100, totalCostUsd: 2 },
    }),
  ),
);
const splitTrends = buildTrends(split, { category: "reads", measure: "cost", axis: "day" });
equal(
  splitTrends.makeup.rows.map((row) => [row.category, row.values[0]]),
  [
    [UNACCOUNTED, 1],
    ["reads", 0.5],
    ["shell", 0.5],
  ],
  "cost splits by each category's share of the context and adds up to the turn",
);
equal(splitTrends.series[0].total, 0.5, "cost series charges the category its part");
console.log("stats checks passed");
