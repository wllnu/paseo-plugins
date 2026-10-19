import { type PluginScreenProps, useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CATEGORY_LABELS, type Category, formatShare, formatTokens } from "../shared/estimate";
import { type Trends, type TrendsInput, UNACCOUNTED, contextTrends } from "../shared/trends";
import { categoryColor } from "./colors";
import { makeStyles } from "./context";

type Theme = PluginScreenProps["theme"];
type Styles = ReturnType<typeof makeDashboardStyles>;

const POLL_MS = 30_000;
const MEASURES = { share: "Share of context", tokens: "Tokens", cost: "Cost" } as const;
const AXES = { day: "Days", week: "Weeks", turn: "Turn number" } as const;
const NAME_WIDTH = 190;
const MODEL_WIDTH = 140;

function makeDashboardStyles(theme: Theme, compact: boolean, platform: string) {
  const { colors } = theme;
  return {
    ...makeStyles(theme, compact, platform),
    page: {
      padding: compact ? 16 : 32,
      gap: compact ? 20 : 28,
      width: "100%" as const,
      maxWidth: 1200,
      alignSelf: "center" as const,
    },
    filters: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 16 },
    tiles: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 12 },
    tile: {
      flexGrow: 1,
      flexBasis: compact ? ("40%" as const) : 0,
      padding: 16,
      gap: 4,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    tileValue: { color: colors.foreground, fontSize: 24, fontWeight: "600" as const },
    section: { gap: 12 },
    heading: { color: colors.foreground, fontSize: 16, fontWeight: "600" as const },
    tableRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      minHeight: compact ? 44 : 36,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tableRowActive: { backgroundColor: colors.surface2 },
    nameCell: { width: NAME_WIDTH, paddingHorizontal: 8 },
    valueCell: { width: MODEL_WIDTH, paddingHorizontal: 8, gap: 3 },
    meter: { height: 4, borderRadius: 2 },
    labelWithSwatch: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    grid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 16 },
    panel: {
      width: compact ? ("100%" as const) : ("48.5%" as const),
      padding: 16,
      gap: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
  };
}

function formatCost(usd: number) {
  return `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`;
}

function categoryLabel(key: string) {
  if (key === UNACCOUNTED) return "Not accounted for";
  return CATEGORY_LABELS[key as Category] ?? key;
}

function bucketLabel(key: string, axis: TrendsInput["axis"]) {
  if (axis === "turn") return `turn ${key}`;
  const [year, month, day] = key.split("-").map(Number);
  const label = new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return axis === "week" ? `week of ${label}` : label;
}

function Chips<Key extends string>({
  label,
  options,
  value,
  onChange,
  styles,
}: {
  label: string;
  options: Record<Key, string>;
  value: Key;
  onChange: (key: Key) => void;
  styles: Styles;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.meta}>{label}</Text>
      <View style={styles.chips}>
        {(Object.entries(options) as [Key, string][]).map(([key, text]) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: key === value }}
            onPress={() => onChange(key)}
            style={[styles.chip, key === value && styles.chipActive]}
          >
            <Text style={[styles.chipText, key === value && styles.chipTextActive]}>{text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Tile({ value, label, styles }: { value: string; label: string; styles: Styles }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.meta}>{label}</Text>
    </View>
  );
}

/** Categories down, models across; tapping a row charts that category over time. */
function MakeupTable({
  makeup,
  selected,
  onSelect,
  format,
  theme,
  styles,
}: {
  makeup: Trends["makeup"];
  selected: string | null;
  onSelect: (category: string) => void;
  format: (value: number) => string;
  theme: Theme;
  styles: Styles;
}) {
  return (
    <ScrollView horizontal>
      <View>
        <View style={styles.tableRow}>
          <Text style={[styles.meta, styles.nameCell]}>Category</Text>
          {makeup.models.map((model) => (
            <Text key={model} numberOfLines={1} style={[styles.meta, styles.valueCell]}>
              {model}
            </Text>
          ))}
        </View>
        {makeup.rows.map((row) => {
          // Bars compare models within a row, so the row's largest value fills the cell.
          const max = Math.max(...row.values, Number.EPSILON);
          const active = row.category === selected;
          const fill = categoryColor(categoryLabel(row.category), theme);
          return (
            <Pressable
              key={row.category}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${categoryLabel(row.category)}: ${row.values
                .map((v, i) => `${makeup.models[i]} ${format(v)}`)
                .join(", ")}`}
              onPress={() => onSelect(row.category)}
              style={[styles.tableRow, active && styles.tableRowActive]}
            >
              <View style={[styles.nameCell, styles.labelWithSwatch]}>
                <View style={[styles.swatch, fill]} />
                <Text numberOfLines={1} style={styles.rowLabel}>
                  {categoryLabel(row.category)}
                </Text>
              </View>
              {row.values.map((v, i) => (
                <View key={makeup.models[i]} style={styles.valueCell}>
                  <Text style={styles.rowValue}>{format(v)}</Text>
                  <View style={[styles.meter, fill, { width: `${(v / max) * 100}%` }]} />
                </View>
              ))}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

function ModelChart({
  row,
  summary,
  unit,
  buckets,
  axis,
  scale,
  format,
  fill,
  styles,
}: {
  row: { model: string; points: Trends["series"][number]["points"] };
  fill: { backgroundColor: string; opacity: number };
  summary: string;
  /** What each bar counts, for "over 3 sessions". */
  unit: "sessions" | "turns";
  buckets: readonly string[];
  axis: TrendsInput["axis"];
  scale: number;
  format: (value: number) => string;
  styles: Styles;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const picked = selected == null ? null : row.points[selected];
  return (
    <View style={styles.panel}>
      <View style={styles.titleRow}>
        <Text numberOfLines={1} style={styles.title}>
          {row.model}
        </Text>
        <Text style={styles.rowValue}>{summary}</Text>
      </View>
      <View style={[styles.chart, { height: 120 }]}>
        {row.points.map((point, bucket) => (
          <Pressable
            key={bucket}
            accessibilityRole="button"
            accessibilityLabel={`${bucketLabel(buckets[bucket], axis)}: ${point ? format(point.value) : "no data"}`}
            accessibilityState={{ selected: bucket === selected }}
            disabled={!point}
            onPress={() => setSelected(bucket === selected ? null : bucket)}
            style={styles.barSlot}
          >
            {point ? (
              <View
                style={[
                  styles.bar,
                  {
                    height: `${(point.value / scale) * 100}%`,
                    backgroundColor: fill.backgroundColor,
                    opacity: fill.opacity * (selected == null || bucket === selected ? 1 : 0.45),
                  },
                ]}
              />
            ) : null}
          </Pressable>
        ))}
      </View>
      <View style={styles.detailBar}>
        <Text style={styles.note}>{bucketLabel(buckets[0], axis)}</Text>
        <Text style={styles.note}>{bucketLabel(buckets[buckets.length - 1], axis)}</Text>
      </View>
      <Text style={styles.meta}>
        {selected != null && picked
          ? `${bucketLabel(buckets[selected], axis)}: ${format(picked.value)} over ${picked.count} ${picked.count === 1 ? unit.slice(0, -1) : unit}`
          : "Tap a bar for its value"}
      </Text>
    </View>
  );
}

export function Dashboard({ theme, layout }: PluginScreenProps) {
  const styles = useMemo(
    () => makeDashboardStyles(theme, layout.compact, layout.platform),
    [theme, layout.compact, layout.platform],
  );
  const [input, setInput] = useState<TrendsInput>({
    category: null,
    measure: "share",
    axis: "day",
  });
  const readTrends = useRpc(contextTrends);
  const trends = useQuery({
    queryKey: ["context-trends", input],
    queryFn: () => readTrends(input),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
  const update = (change: Partial<TrendsInput>) =>
    setInput((current) => ({ ...current, ...change }));

  let body;
  if (trends.error) {
    body = <Text style={styles.error}>Could not read the history. {trends.error.message}</Text>;
  } else if (trends.isPending) {
    body = <Text style={styles.message}>Loading…</Text>;
  } else if (trends.data.summary.turns === 0) {
    body = (
      <Text style={styles.message}>
        Nothing recorded yet. A row is saved to ~/.paseo-context/sessions.jsonl each time an agent
        finishes a turn.
      </Text>
    );
  } else {
    const { summary, makeup, category, buckets, series, costs } = trends.data;
    const format = { share: formatShare, tokens: formatTokens, cost: formatCost }[input.measure];
    const categoryFill = category ? categoryColor(categoryLabel(category), theme) : null;
    const costFill = { backgroundColor: theme.colors.foregroundMuted, opacity: 1 };
    // One scale for every model, so bar heights compare across charts.
    const scale = Math.max(
      ...series.flatMap((row) => row.points.map((point) => point?.value ?? 0)),
      Number.EPSILON,
    );
    const costScale = Math.max(
      ...costs.flatMap((row) => row.points.map((point) => point?.value ?? 0)),
      Number.EPSILON,
    );
    const sessionsText = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;
    body = (
      <>
        <View style={styles.tiles}>
          <Tile value={String(summary.sessions)} label="Sessions" styles={styles} />
          <Tile value={String(summary.turns)} label="Turns recorded" styles={styles} />
          <Tile value={String(makeup.models.length)} label="Models" styles={styles} />
          <Tile value={formatCost(summary.costUsd)} label="Cost" styles={styles} />
          <Tile
            value={
              summary.since
                ? new Date(summary.since).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                : "–"
            }
            label="Recording since"
            styles={styles}
          />
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>What fills the context, by model</Text>
          <Text style={styles.note}>
            {input.measure === "cost"
              ? "Average cost per session charged to each category."
              : "Average per session at its latest turn."}{" "}
            Tap a category to chart it below.
          </Text>
          <MakeupTable
            makeup={makeup}
            selected={category}
            onSelect={(key) => update({ category: key })}
            format={format}
            theme={theme}
            styles={styles}
          />
        </View>
        {category ? (
          <View style={styles.section}>
            <View style={styles.labelWithSwatch}>
              {categoryFill ? <View style={[styles.swatch, categoryFill]} /> : null}
              <Text style={styles.heading}>
                {categoryLabel(category)} by {input.axis === "turn" ? "turn number" : input.axis}
              </Text>
            </View>
            <Text style={styles.note}>
              {input.measure === "cost"
                ? input.axis === "turn"
                  ? "Average cost per turn charged to this category in each turn range."
                  : "Cost charged to this category by the turns that ended in each period."
                : input.axis === "turn"
                  ? "Each bar averages every recorded turn in that turn range, showing how the context fills as a session goes on."
                  : "Each session counts once, at its latest turn, in the period that turn ended."}{" "}
              All charts share one scale; the top is {format(scale)}.
            </Text>
            <View style={styles.grid}>
              {series.map((row) => (
                <ModelChart
                  key={`${row.model}-${input.axis}-${category}`}
                  row={row}
                  summary={
                    input.measure === "cost"
                      ? `${formatCost(row.total)} · ${formatCost(row.total / row.sessions)} per session · ${sessionsText(row.sessions)}`
                      : `avg ${format(row.average)} · ${sessionsText(row.sessions)}`
                  }
                  unit={input.axis === "turn" || input.measure === "cost" ? "turns" : "sessions"}
                  fill={categoryFill ?? costFill}
                  buckets={buckets}
                  axis={input.axis}
                  scale={scale}
                  format={format}
                  styles={styles}
                />
              ))}
            </View>
          </View>
        ) : null}
        {costs.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.heading}>
              Cost by {input.axis === "turn" ? "turn number" : input.axis}
            </Text>
            <Text style={styles.note}>
              {input.axis === "turn"
                ? "Average cost of a single turn in each turn range, so you can see whether later turns get more expensive."
                : "Total cost of the turns that ended in each period."}{" "}
              All charts share one scale; the top is {formatCost(costScale)}. Cost is what the
              provider reported.
            </Text>
            <View style={styles.grid}>
              {costs.map((row) => (
                <ModelChart
                  key={`cost-${row.model}-${input.axis}`}
                  row={row}
                  summary={`${formatCost(row.totalUsd)} · ${formatCost(row.perSessionUsd)} per session · ${sessionsText(row.sessions)}`}
                  buckets={buckets}
                  axis={input.axis}
                  scale={costScale}
                  unit="turns"
                  format={formatCost}
                  fill={costFill}
                  styles={styles}
                />
              ))}
            </View>
          </View>
        ) : null}
        <Text style={styles.note}>
          {input.measure === "share"
            ? "Share is the category's estimated tokens over the context size the provider reported. "
            : ""}
          {input.measure === "cost"
            ? "Cost per category is an estimate: each turn's cost is split by each category's share of the context, because every call re-sends the whole context. Output tokens are split the same way. "
            : ""}
          Token counts are estimated at 4 characters per token. System prompt, tools and memory are
          measured for Claude agents only. Data from all workspaces in
          ~/.paseo-context/sessions.jsonl.
        </Text>
      </>
    );
  }

  return (
    <ScrollView style={styles.screen}>
      <View style={styles.page}>
        <View style={styles.filters}>
          <Chips
            label="Measure"
            options={MEASURES}
            value={input.measure}
            onChange={(measure) => update({ measure })}
            styles={styles}
          />
          <Chips
            label="Over"
            options={AXES}
            value={input.axis}
            onChange={(axis) => update({ axis })}
            styles={styles}
          />
        </View>
        {body}
      </View>
    </ScrollView>
  );
}
