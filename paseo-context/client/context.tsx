import { type PluginWorkspacePanelProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  CATEGORY_LABELS,
  type ContextItem,
  allocateCells,
  estimateContext,
  estimateTokens,
  formatShare,
  formatTokens,
} from "../shared/estimate";
import { fixedContext } from "../shared/fixed";
import { categoryColor } from "./colors";

type Paseo = ReturnType<typeof usePaseo>;
type Agent = Awaited<ReturnType<Paseo["agents"]["list"]>>["entries"][number]["agent"];
type Theme = PluginWorkspacePanelProps["theme"];
export type Styles = ReturnType<typeof makeStyles>;

// Paseo records the delegating agent in this label (PARENT_AGENT_ID_LABEL in @getpaseo/protocol).
const PARENT_LABEL = "paseo.parent-agent-id";
const POLL_MS = 3000;
const TIMELINE_LIMIT = 500;
const GRID_CELLS = 100;
const MAX_ITEMS = 30;
const MAX_TEXT_LINES = 200;
const MAX_TEXT_CHARS = 8000;

function isBusy(agent: Agent) {
  return agent.status === "running" || agent.status === "initializing";
}

// What the provider reported after the last turn. Either number can be missing.
function reportedContext(agent: Agent) {
  const used = agent.lastUsage?.contextWindowUsedTokens;
  const max = agent.lastUsage?.contextWindowMaxTokens;
  return {
    used: used ?? null,
    max: max ?? null,
    fraction: used != null && max ? Math.min(used / max, 1) : null,
  };
}

function fillColor(fraction: number, theme: Theme) {
  if (fraction >= 0.9) return theme.colors.statusDanger;
  if (fraction >= 0.7) return theme.colors.statusWarning;
  return theme.colors.accent;
}

export function makeStyles(theme: Theme, compact: boolean, platform: string) {
  const { colors } = theme;
  const mono = platform === "ios" ? "Menlo" : "monospace";
  const pad = compact ? 12 : 14;
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    content: { padding: compact ? 16 : 24, gap: compact ? 12 : 16 },
    summary: { color: colors.foregroundMuted, fontSize: 13 },
    message: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
    error: { color: colors.statusDanger, fontSize: 14 },
    card: {
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 10,
      overflow: "hidden" as const,
    },
    cardHeader: { padding: pad, gap: 8 },
    titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    title: {
      flex: 1,
      minWidth: 0,
      color: colors.foreground,
      fontSize: 14,
      fontWeight: "600" as const,
    },
    percent: { fontSize: 14, fontWeight: "600" as const },
    track: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surface2,
      overflow: "hidden" as const,
    },
    fill: { height: 6, borderRadius: 3 },
    meta: { color: colors.foregroundMuted, fontSize: 12 },
    detail: { borderTopColor: colors.border, borderTopWidth: 1, padding: pad, gap: 10 },
    detailBar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: 8,
    },
    link: { color: colors.accent, fontSize: 13, fontWeight: "600" as const },
    // 20 cells per row: 4% wide with 0.5% margin on each side.
    grid: { flexDirection: "row" as const, flexWrap: "wrap" as const },
    cell: {
      width: "4%" as const,
      aspectRatio: 1,
      margin: "0.5%" as const,
      borderRadius: 2,
      backgroundColor: colors.surface2,
    },
    rowLine: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      minHeight: compact ? 44 : 32,
    },
    items: { paddingLeft: 18 },
    item: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      minHeight: compact ? 44 : 28,
    },
    itemTitle: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 12, fontFamily: mono },
    body: { backgroundColor: colors.surface2, marginBottom: 6, padding: 10, borderRadius: 6 },
    bodyText: { color: colors.foreground, fontSize: 12, lineHeight: 17, fontFamily: mono },
    swatch: { width: 10, height: 10, borderRadius: 2 },
    rowLabel: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13 },
    rowValue: { color: colors.foregroundMuted, fontSize: 12 },
    note: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
    chip: {
      minHeight: compact ? 44 : 28,
      paddingHorizontal: 10,
      justifyContent: "center" as const,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { borderColor: colors.accent, backgroundColor: colors.surface2 },
    chipText: { color: colors.foregroundMuted, fontSize: 13 },
    chipTextActive: { color: colors.foreground, fontWeight: "600" as const },
    chart: {
      height: 72,
      flexDirection: "row" as const,
      alignItems: "flex-end" as const,
      gap: 2,
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
    },
    barSlot: { flex: 1, height: "100%" as const, justifyContent: "flex-end" as const },
    bar: {
      minHeight: 2,
      borderTopLeftRadius: 2,
      borderTopRightRadius: 2,
      backgroundColor: colors.accent,
    },
  };
}

function ItemRow({
  item,
  cwd,
  theme,
  styles,
}: {
  item: ContextItem;
  cwd: string;
  theme: Theme;
  styles: Styles;
}) {
  const [open, setOpen] = useState(false);
  const title = item.title.replace(`${cwd}/`, "");
  const lines = item.text.split("\n");
  const shown = lines.slice(0, MAX_TEXT_LINES).join("\n").slice(0, MAX_TEXT_CHARS);
  const cut = shown.length < item.text.length || estimateTokens(item.text.length) < item.tokens;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, about ${formatTokens(item.tokens)} tokens`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.item}
      >
        <Icon
          name={open ? "ChevronDown" : "ChevronRight"}
          size={12}
          color={theme.colors.foregroundMuted}
        />
        <Text numberOfLines={1} style={styles.itemTitle}>
          {title}
        </Text>
        <Text style={styles.rowValue}>~{formatTokens(item.tokens)}</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <Text selectable style={styles.bodyText}>
            {shown}
            {cut ? "\n… cut short here" : ""}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function CategoryRow({
  row,
  share,
  swatch,
  cwd,
  theme,
  styles,
}: {
  row: { label: string; tokens: number; items: readonly ContextItem[] };
  share: number;
  swatch: ReturnType<typeof categoryColor>;
  cwd: string;
  theme: Theme;
  styles: Styles;
}) {
  const [open, setOpen] = useState(false);
  const canOpen = row.items.length > 0;
  const hidden = row.items.length - MAX_ITEMS;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.label}, about ${formatTokens(row.tokens)} tokens, ${formatShare(share)}`}
        accessibilityState={{ expanded: open, disabled: !canOpen }}
        disabled={!canOpen}
        onPress={() => setOpen((value) => !value)}
        style={styles.rowLine}
      >
        <View style={[styles.swatch, swatch]} />
        <Text numberOfLines={1} style={styles.rowLabel}>
          {row.label}
        </Text>
        <Text style={styles.rowValue}>
          ~{formatTokens(row.tokens)} · {formatShare(share)}
        </Text>
        {canOpen ? (
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={theme.colors.foregroundMuted}
          />
        ) : null}
      </Pressable>
      {open ? (
        <View style={styles.items}>
          {row.items.slice(0, MAX_ITEMS).map((item, index) => (
            <ItemRow key={index} item={item} cwd={cwd} theme={theme} styles={styles} />
          ))}
          {hidden > 0 ? <Text style={styles.note}>… {hidden} smaller items not shown</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function Breakdown({ agent, theme, styles }: { agent: Agent; theme: Theme; styles: Styles }) {
  const paseo = usePaseo();
  const busy = isBusy(agent);
  // lazy: reads only the latest TIMELINE_LIMIT items and polls while the agent is busy.
  // Upgrade path: page back with refetch({ cursor }) until the last compaction or the start.
  const timeline = useQuery({
    queryKey: ["context-timeline", agent.id, busy ? "live" : agent.updatedAt],
    queryFn: () =>
      paseo.agents
        .ref(agent.id)
        .timeline.refetch({ direction: "tail", limit: TIMELINE_LIMIT, projection: "projected" }),
    refetchInterval: busy ? POLL_MS : false,
    staleTime: busy ? 0 : Infinity,
    placeholderData: keepPreviousData,
  });
  const measureFixed = useRpc(fixedContext);
  const fixed = useQuery({
    queryKey: ["context-fixed", agent.id, agent.updatedAt],
    queryFn: () => measureFixed({ agentId: agent.id }),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
  const estimate = useMemo(
    () => estimateContext(timeline.data?.entries.map((entry) => entry.item) ?? []),
    [timeline.data],
  );

  if (timeline.error) {
    return <Text style={styles.error}>Could not load the timeline. {timeline.error.message}</Text>;
  }
  if (timeline.isPending) return <Text style={styles.note}>Loading the timeline…</Text>;

  const { used, max } = reportedContext(agent);
  const parts = fixed.data?.parts ?? [];
  const measured = estimate.total + parts.reduce((sum, part) => sum + part.tokens, 0);
  // Whatever the provider counted that nothing above explains. Without the split this is
  // the whole system prompt, tools and memory; with it, mostly a compaction summary.
  const rest = used != null && used > measured ? used - measured : 0;
  const rows = [
    ...estimate.categories.map(({ category, tokens, items }) => ({
      label: CATEGORY_LABELS[category],
      tokens,
      items,
    })),
    ...parts,
    ...(rest > 0
      ? [
          {
            label: parts.length ? "Not accounted for" : "System prompt, tools and memory",
            tokens: rest,
            items: [],
          },
        ]
      : []),
  ].sort((a, b) => b.tokens - a.tokens);
  if (rows.length === 0) return <Text style={styles.note}>Nothing in the context yet.</Text>;

  // The grid is the whole window when the provider reports its size, otherwise just what is used.
  const total = max ?? rows.reduce((sum, row) => sum + row.tokens, 0);
  const cells = allocateCells(
    rows.map((row) => row.tokens),
    total,
    GRID_CELLS,
  );
  const filled = cells.flatMap((count, index) => Array<number>(count).fill(index));
  const truncated = timeline.data.hasOlder && !estimate.compacted;

  return (
    <>
      <View
        accessible
        accessibilityLabel={`Context grid, ${filled.length} of ${GRID_CELLS} cells filled`}
        style={styles.grid}
      >
        {Array.from({ length: GRID_CELLS }, (_, cell) => (
          <View
            key={cell}
            style={[
              styles.cell,
              cell < filled.length && categoryColor(rows[filled[cell]].label, theme),
            ]}
          />
        ))}
      </View>
      {rows.map((row) => (
        <CategoryRow
          key={row.label}
          row={row}
          share={row.tokens / total}
          swatch={categoryColor(row.label, theme)}
          cwd={agent.cwd}
          theme={theme}
          styles={styles}
        />
      ))}
      <Text style={styles.note}>
        Tap a row to see what is in it. Sizes are estimated at 4 characters per token.
        {max ? " Empty cells are free space." : ""}
        {fixed.error ? ` Could not read the session record. ${fixed.error.message}` : ""}
        {fixed.isSuccess && parts.length === 0
          ? " The split of system prompt, tools and memory is only available for Claude agents."
          : ""}
        {estimate.compacted ? " Counts only items after the last compaction." : ""}
        {truncated ? ` Counts only the latest ${TIMELINE_LIMIT} timeline items.` : ""}
      </Text>
    </>
  );
}

function AgentCard({
  agent,
  parentTitle,
  theme,
  styles,
  navigation,
}: {
  agent: Agent;
  parentTitle: string | null;
  theme: Theme;
  styles: Styles;
  navigation: PluginWorkspacePanelProps["navigation"];
}) {
  const [open, setOpen] = useState(false);
  const title = agent.title ?? `Agent ${agent.id.slice(0, 8)}`;
  const { used, max, fraction } = reportedContext(agent);
  const color = fraction == null ? theme.colors.foregroundMuted : fillColor(fraction, theme);
  const percent = fraction == null ? null : `${Math.round(fraction * 100)}%`;
  const cost = agent.lastUsage?.totalCostUsd;
  const usage =
    used == null
      ? "No context figure reported yet"
      : max
        ? `${formatTokens(used)} of ${formatTokens(max)} tokens`
        : `${formatTokens(used)} tokens`;
  const meta = [
    usage,
    cost ? `$${cost.toFixed(2)}` : null,
    agent.model ?? agent.provider,
    isBusy(agent) ? "running" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${percent ? `${percent} of context used. ` : ""}${usage}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.cardHeader}
      >
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {percent ? <Text style={[styles.percent, { color }]}>{percent}</Text> : null}
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            size={16}
            color={theme.colors.foregroundMuted}
          />
        </View>
        <View style={styles.track}>
          <View
            style={[styles.fill, { width: `${(fraction ?? 0) * 100}%`, backgroundColor: color }]}
          />
        </View>
        <Text numberOfLines={1} style={styles.meta}>
          {meta}
        </Text>
        {parentTitle ? (
          <Text numberOfLines={1} style={styles.meta}>
            Subagent of {parentTitle}
          </Text>
        ) : null}
      </Pressable>
      {open ? (
        <View style={styles.detail}>
          <Breakdown agent={agent} theme={theme} styles={styles} />
          {navigation ? (
            <View style={styles.detailBar}>
              <View />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${title}`}
                hitSlop={12}
                onPress={() => navigation.openAgent({ agentId: agent.id })}
              >
                <Text style={styles.link}>Open agent</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function ContextPanel({
  theme,
  layout,
  navigation,
  workspaceId,
}: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const styles = useMemo(
    () => makeStyles(theme, layout.compact, layout.platform),
    [theme, layout.compact, layout.platform],
  );
  // lazy: polls the agent directory (capped at 200 agents) while this panel is open.
  // Upgrade path: agents.list({ subscribe: {} }) and apply agent_update messages.
  const agents = useQuery({
    queryKey: ["context-agents"],
    queryFn: () =>
      paseo.agents.list({
        filter: { includeArchived: false },
        sort: [{ key: "created_at", direction: "desc" }],
        page: { limit: 200 },
      }),
    refetchInterval: POLL_MS,
  });

  const rows = useMemo(() => {
    const all = agents.data?.entries.map((entry) => entry.agent) ?? [];
    const byId = new Map(all.map((agent) => [agent.id, agent]));
    return (
      all
        .map((agent) => ({ agent, parent: byId.get(agent.labels[PARENT_LABEL] ?? "") }))
        // A subagent belongs to this workspace if it or its parent runs here (it may get its own worktree).
        .filter(
          ({ agent, parent }) =>
            agent.workspaceId === workspaceId || parent?.workspaceId === workspaceId,
        )
        // Fullest first; agents with no reported figure keep directory order at the end.
        .sort(
          (a, b) =>
            (reportedContext(b.agent).fraction ?? -1) - (reportedContext(a.agent).fraction ?? -1),
        )
    );
  }, [agents.data, workspaceId]);

  const high = rows.filter(({ agent }) => (reportedContext(agent).fraction ?? 0) >= 0.7).length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {agents.error ? (
        <Text style={styles.error}>Could not load agents. {agents.error.message}</Text>
      ) : agents.isPending ? (
        <Text style={styles.message}>Loading agents…</Text>
      ) : rows.length === 0 ? (
        <Text style={styles.message}>No agents in this workspace yet.</Text>
      ) : (
        <Text style={styles.summary}>
          {rows.length} {rows.length === 1 ? "agent" : "agents"}
          {high > 0 ? ` · ${high} above 70%` : ""}
        </Text>
      )}
      {rows.map(({ agent, parent }) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          parentTitle={parent ? (parent.title ?? `Agent ${parent.id.slice(0, 8)}`) : null}
          theme={theme}
          styles={styles}
          navigation={navigation}
        />
      ))}
    </ScrollView>
  );
}
