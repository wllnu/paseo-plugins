import { type RpcOutput, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { TurnRecord } from "./stats";

const point = z.object({ value: z.number(), count: z.number() }).nullable();

export const trendsInput = z.object({
  /** A `Category` key or a fixed part label; null picks file reads, else the largest. */
  category: z.string().nullable(),
  measure: z.enum(["share", "tokens", "cost"]),
  axis: z.enum(["day", "week", "turn"]),
});

export type TrendsInput = z.infer<typeof trendsInput>;

export const contextTrends = defineRpc({
  name: "context.trends",
  input: trendsInput,
  output: z.object({
    summary: z.object({
      sessions: z.number(),
      turns: z.number(),
      since: z.string().nullable(),
      costUsd: z.number(),
    }),
    /** Average per session (latest turn) for every category and model, in the chosen measure. */
    makeup: z.object({
      models: z.array(z.string()),
      rows: z.array(z.object({ category: z.string(), values: z.array(z.number()) })),
    }),
    /** Every category seen, largest first. */
    categories: z.array(z.string()),
    category: z.string().nullable(),
    buckets: z.array(z.string()),
    /** One series per model, highest average first; points line up with `buckets`. */
    series: z.array(
      z.object({
        model: z.string(),
        sessions: z.number(),
        /** Per session (latest turn) for share and tokens; per turn for cost. */
        average: z.number(),
        total: z.number(),
        points: z.array(point),
      }),
    ),
    /**
     * One series per model that reported cost, most expensive first. Days and weeks sum the cost
     * of turns that ended in each period; turn number averages the cost of a single turn.
     */
    costs: z.array(
      z.object({
        model: z.string(),
        sessions: z.number(),
        totalUsd: z.number(),
        perSessionUsd: z.number(),
        points: z.array(point),
      }),
    ),
  }),
});

export type Trends = RpcOutput<typeof contextTrends>;

const MAX_DATE_BUCKETS = 30;
const TURN_BUCKETS = ["1", "2–3", "4–7", "8–15", "16–31", "32+"];

function sum(values: Record<string, number>) {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

/** What the provider counted that no category explains, such as a compaction summary. */
export const UNACCOUNTED = "unaccounted";

function measured(record: TurnRecord) {
  return sum(record.categories) + sum(record.fixed);
}

function tokensOf(record: TurnRecord, category: string) {
  if (category === UNACCOUNTED) {
    const used = record.usage?.contextWindowUsedTokens;
    return used == null ? 0 : Math.max(0, used - measured(record));
  }
  return record.categories[category] ?? record.fixed[category] ?? 0;
}

/** Share of the context the provider reported, or of everything measured when it reported none. */
function share(record: TurnRecord, category: string) {
  const total = record.usage?.contextWindowUsedTokens ?? measured(record);
  return total > 0 ? Math.min(tokensOf(record, category) / total, 1) : 0;
}

/**
 * The part of a turn's cost to charge to a category: every call re-sends the whole context, so
 * each category pays its share of it. Shares here never add up past the whole turn.
 */
function costShare(record: TurnRecord, category: string) {
  const total = Math.max(record.usage?.contextWindowUsedTokens ?? 0, measured(record));
  return total > 0 ? tokensOf(record, category) / total : 0;
}

/** Local calendar day, as YYYY-MM-DD. */
function dayKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Midnight of the record's local day, or of the Monday that starts its week. */
function bucketStart(at: string, axis: "day" | "week") {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  if (axis === "week") date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function turnBucket(turns: number) {
  return Math.min(Math.floor(Math.log2(Math.max(turns, 1))), TURN_BUCKETS.length - 1);
}

function modelOf(record: TurnRecord) {
  return record.model ?? record.provider;
}

function average(values: readonly number[]) {
  return values.length ? values.reduce((total, v) => total + v, 0) / values.length : 0;
}

/**
 * Cost of each turn, or null when the provider reported none. Providers report a running session
 * total; a drop means the session reopened and the total started over.
 */
export function turnCosts(records: readonly TurnRecord[]) {
  const previous = new Map<string, number>();
  return records.map((record) => {
    const total = record.usage?.totalCostUsd;
    if (total == null) return null;
    const before = previous.get(record.agentId) ?? 0;
    previous.set(record.agentId, total);
    return total >= before ? total - before : total;
  });
}

/** The latest record of each agent: what its context looked like when it last finished a turn. */
function lastPerSession(records: readonly TurnRecord[]) {
  const last = new Map<string, TurnRecord>();
  for (const record of records) last.set(record.agentId, record);
  return [...last.values()];
}

export function buildTrends(records: readonly TurnRecord[], input: TrendsInput): Trends {
  const sessions = lastPerSession(records);
  const totals = new Map<string, number>();
  for (const record of sessions) {
    for (const [key, tokens] of [
      ...Object.entries(record.categories),
      ...Object.entries(record.fixed),
      [UNACCOUNTED, tokensOf(record, UNACCOUNTED)] as const,
    ]) {
      if (tokens > 0) totals.set(key, (totals.get(key) ?? 0) + tokens);
    }
  }
  const categories = [...totals].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  const category =
    input.category && totals.has(input.category)
      ? input.category
      : totals.has("reads")
        ? "reads"
        : (categories[0] ?? null);
  const costs = turnCosts(records);
  const allocated = (i: number, key: string) => (costs[i] ?? 0) * costShare(records[i], key);
  const indicesByAgent = new Map<string, number[]>();
  records.forEach((record, i) => {
    indicesByAgent.set(record.agentId, [...(indicesByAgent.get(record.agentId) ?? []), i]);
  });
  /** One session's figure: its latest share or tokens, or everything it spent. */
  const sessionValue = (record: TurnRecord, key: string) => {
    if (input.measure === "share") return share(record, key);
    if (input.measure === "tokens") return tokensOf(record, key);
    return (indicesByAgent.get(record.agentId) ?? []).reduce((t, i) => t + allocated(i, key), 0);
  };
  const summary = {
    sessions: sessions.length,
    turns: records.length,
    since: records[0]?.at ?? null,
    costUsd: costs.reduce<number>((total, cost) => total + (cost ?? 0), 0),
  };
  const sessionsByModel = new Map<string, TurnRecord[]>();
  for (const record of sessions) {
    sessionsByModel.set(modelOf(record), [...(sessionsByModel.get(modelOf(record)) ?? []), record]);
  }
  const models = [...sessionsByModel].sort((a, b) => b[1].length - a[1].length);
  const makeup = {
    models: models.map(([model]) => model),
    rows: categories.map((key) => ({
      category: key,
      values: models.map(([, list]) => average(list.map((r) => sessionValue(r, key)))),
    })),
  };
  if (records.length === 0) {
    return {
      summary,
      makeup,
      categories,
      category,
      buckets: [],
      series: [],
      costs: [],
    };
  }

  // Each record lands in one bucket: its turn range, or the day or week it ended in.
  let buckets: string[];
  let bucketOf: (record: TurnRecord) => number;
  if (input.axis === "turn") {
    buckets = TURN_BUCKETS.slice(0, Math.max(-1, ...records.map((r) => turnBucket(r.turns))) + 1);
    bucketOf = (record) => turnBucket(record.turns);
  } else {
    const axis = input.axis;
    const step = axis === "week" ? 7 : 1;
    const starts = records.map((record) => Number(bucketStart(record.at, axis)));
    const last = new Date(Math.max(...starts));
    const firstShown = new Date(last);
    firstShown.setDate(firstShown.getDate() - step * (MAX_DATE_BUCKETS - 1));
    const cursor = new Date(Math.max(Math.min(...starts), Number(firstShown)));
    buckets = [];
    for (; cursor <= last; cursor.setDate(cursor.getDate() + step)) buckets.push(dayKey(cursor));
    const index = new Map(buckets.map((key, i) => [key, i]));
    bucketOf = (record) => index.get(dayKey(bucketStart(record.at, axis))) ?? -1;
  }

  function seriesOf(units: { record: TurnRecord; value: number }[], combine: "mean" | "sum") {
    const byModel = new Map<string, typeof units>();
    for (const unit of units) {
      const model = modelOf(unit.record);
      byModel.set(model, [...(byModel.get(model) ?? []), unit]);
    }
    return [...byModel].map(([model, list]) => {
      const sums = buckets.map(() => ({ total: 0, count: 0 }));
      for (const { record, value: v } of list) {
        const bucket = bucketOf(record);
        if (bucket < 0) continue;
        sums[bucket].total += v;
        sums[bucket].count++;
      }
      const total = list.reduce((t, unit) => t + unit.value, 0);
      return {
        model,
        sessions: new Set(list.map((unit) => unit.record.agentId)).size,
        total,
        average: total / list.length,
        points: sums.map(({ total, count }) =>
          count ? { value: combine === "sum" ? total : total / count, count } : null,
        ),
      };
    });
  }

  // Share and tokens count each session once at its latest turn, except by turn number, where
  // every turn counts. Cost charges every turn: summed per period, averaged per turn range.
  let units: { record: TurnRecord; value: number }[] = [];
  if (category && input.measure === "cost") {
    units = records.flatMap((record, i) =>
      costs[i] == null ? [] : [{ record, value: allocated(i, category) }],
    );
  } else if (category) {
    const pick = input.measure === "share" ? share : tokensOf;
    units = (input.axis === "turn" ? records : sessions).map((record) => ({
      record,
      value: pick(record, category),
    }));
  }
  const series = seriesOf(units, input.measure === "cost" && input.axis !== "turn" ? "sum" : "mean")
    .map(({ model, sessions, average, total, points }) => ({
      model,
      sessions,
      average,
      total,
      points,
    }))
    .sort((a, b) => (input.measure === "cost" ? b.total - a.total : b.average - a.average));

  const costUnits = records.flatMap((record, i) => {
    const cost = costs[i];
    return cost == null ? [] : [{ record, value: cost }];
  });
  const costSeries = seriesOf(costUnits, input.axis === "turn" ? "mean" : "sum")
    .map(({ model, sessions, total, points }) => ({
      model,
      sessions,
      totalUsd: total,
      perSessionUsd: total / sessions,
      points,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd);

  return {
    summary,
    makeup,
    categories,
    category,
    buckets,
    series,
    costs: costSeries,
  };
}
