import {
  type PluginSurfaceProps,
  type PluginWorkspacePanelProps,
  usePaseo,
  useRpc,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { stopAgent } from "../shared/stop";

type Paseo = ReturnType<typeof usePaseo>;
type Agent = Awaited<ReturnType<Paseo["agents"]["list"]>>["entries"][number]["agent"];
type TimelineEntry = Awaited<
  ReturnType<ReturnType<Paseo["agents"]["ref"]>["timeline"]["refetch"]>
>["entries"][number];
type ToolCall = Extract<TimelineEntry["item"], { type: "tool_call" }>;
// A subagent the provider runs inside the parent's own session (Claude's Agent tool). It is not a
// Paseo agent, so it never appears in the agent directory, only as a tool call on the parent.
type Task = ToolCall & { detail: Extract<ToolCall["detail"], { type: "sub_agent" }> };
type Theme = PluginSurfaceProps["theme"];
type Styles = ReturnType<typeof makeStyles>;

// Paseo records the delegating agent in this label (PARENT_AGENT_ID_LABEL in @getpaseo/protocol).
const PARENT_LABEL = "paseo.parent-agent-id";
const POLL_MS = 2000;
const MAX_BODY_LINES = 200;

function isBusy(agent: Agent) {
  return agent.status === "running" || agent.status === "initializing";
}

function isTask(item: TimelineEntry["item"]): item is Task {
  return item.type === "tool_call" && item.detail.type === "sub_agent";
}

// A task cannot outlive its parent's turn, so a "running" one under an idle parent was cut off.
function isTaskBusy(task: Task, parent: Agent) {
  return task.status === "running" && isBusy(parent);
}

// lazy: polls the timeline tail while the agent is busy instead of merging live stream events.
// Upgrade path: timeline.subscribe() plus refetch({ direction: "after", cursor }) on each event.
function timelineQuery(paseo: Paseo, agent: Agent) {
  const busy = isBusy(agent);
  return queryOptions({
    queryKey: ["subagent-timeline", agent.id, busy ? "live" : agent.updatedAt],
    queryFn: () =>
      paseo.agents
        .ref(agent.id)
        .timeline.refetch({ direction: "tail", limit: 100, projection: "projected" }),
    refetchInterval: busy ? POLL_MS : false,
    staleTime: busy ? 0 : Infinity,
    placeholderData: keepPreviousData,
  });
}

function statusOf(agent: Agent, theme: Theme) {
  const { colors } = theme;
  if (agent.pendingPermissions.length > 0 || agent.attentionReason === "permission") {
    return { label: "Needs permission", color: colors.statusWarning };
  }
  if (agent.status === "error") return { label: "Error", color: colors.statusDanger };
  if (agent.status === "running") return { label: "Running", color: colors.accent };
  if (agent.status === "initializing") return { label: "Starting", color: colors.accent };
  if (agent.status === "closed") return { label: "Closed", color: colors.foregroundMuted };
  return { label: "Finished", color: colors.statusSuccess };
}

function relativePath(filePath: string, cwd: string) {
  return filePath.startsWith(`${cwd}/`) ? filePath.slice(cwd.length + 1) : filePath;
}

function prefixLines(text: string | undefined, prefix: string) {
  if (!text) return [];
  return text.split("\n").map((line) => prefix + line);
}

export function describeTool(item: ToolCall, cwd: string) {
  const { detail } = item;
  switch (detail.type) {
    case "shell":
      return { icon: "SquareTerminal", title: detail.command, body: detail.output };
    case "read":
      return { icon: "Eye", title: `Read ${relativePath(detail.filePath, cwd)}` };
    case "edit":
      return {
        icon: "Pencil",
        title: `Edit ${relativePath(detail.filePath, cwd)}`,
        body:
          detail.unifiedDiff ??
          [...prefixLines(detail.oldString, "-"), ...prefixLines(detail.newString, "+")].join("\n"),
        diff: true,
      };
    case "write":
      return {
        icon: "FilePlus",
        title: `Write ${relativePath(detail.filePath, cwd)}`,
        body: detail.content,
      };
    case "search":
      return { icon: "Search", title: `Search ${detail.query}`, body: detail.content };
    case "fetch":
      return { icon: "Globe", title: `Fetch ${detail.url}`, body: detail.result };
    case "sub_agent":
      return {
        icon: "Bot",
        title: detail.description ?? detail.subAgentType ?? item.name,
        body: detail.log,
      };
    case "plan":
      return { icon: "ListChecks", title: "Plan", body: detail.text };
    case "worktree_setup":
      return { icon: "GitBranch", title: `Worktree ${detail.branchName}`, body: detail.log };
    case "plain_text":
      return { icon: "Wrench", title: detail.label ?? item.name, body: detail.text };
    default:
      return {
        icon: "Wrench",
        title: item.name,
        body: detail.input == null ? undefined : JSON.stringify(detail.input, null, 2),
      };
  }
}

function firstLine(text: string) {
  return text.trim().split("\n")[0] ?? "";
}

// What the agent is doing right now: its latest tool call or message.
function currentActivity(entries: readonly TimelineEntry[], cwd: string) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const { item } = entries[i];
    if (item.type === "tool_call") return firstLine(describeTool(item, cwd).title);
    if (item.type === "assistant_message" && item.text.trim()) return firstLine(item.text);
  }
  return null;
}

function makeStyles(theme: Theme, compact: boolean, platform: string) {
  const { colors } = theme;
  const mono = platform === "ios" ? "Menlo" : "monospace";
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    content: { padding: compact ? 16 : 24, gap: compact ? 12 : 16 },
    summary: { color: colors.foregroundMuted, fontSize: 13 },
    message: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
    error: { color: colors.statusDanger, fontSize: 14 },
    group: { gap: 8 },
    groupHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    groupTitle: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
    card: {
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 10,
      overflow: "hidden" as const,
    },
    cardHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      padding: compact ? 12 : 14,
    },
    cardToggle: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
    },
    stop: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      minHeight: 32,
      paddingHorizontal: 10,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
    },
    stopPending: { opacity: 0.6 },
    stopText: { color: colors.statusDanger, fontSize: 12, fontWeight: "600" as const },
    cardText: { flex: 1, minWidth: 0, gap: 2 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    title: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
    activity: { color: colors.foregroundMuted, fontSize: 13 },
    status: { fontSize: 12, fontWeight: "600" as const },
    work: { borderTopColor: colors.border, borderTopWidth: 1 },
    workBar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: compact ? 12 : 14,
      paddingVertical: 8,
    },
    link: { color: colors.accent, fontSize: 13, fontWeight: "600" as const },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: compact ? 12 : 14,
      minHeight: 44,
    },
    rowTitle: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13, fontFamily: mono },
    rowMeta: { fontSize: 12 },
    said: {
      color: colors.foregroundMuted,
      fontSize: 13,
      lineHeight: 18,
      paddingHorizontal: compact ? 12 : 14,
      paddingVertical: 8,
    },
    body: {
      backgroundColor: colors.surface2,
      marginHorizontal: compact ? 12 : 14,
      marginBottom: 8,
      padding: 10,
      borderRadius: 6,
    },
    bodyText: { color: colors.foreground, fontSize: 12, lineHeight: 17, fontFamily: mono },
    added: { color: colors.statusSuccess },
    removed: { color: colors.statusDanger },
  };
}

function ToolBody({ text, diff, styles }: { text: string; diff?: boolean; styles: Styles }) {
  const lines = text.split("\n");
  const shown = lines.slice(0, MAX_BODY_LINES);
  const hidden = lines.length - shown.length;
  return (
    <View style={styles.body}>
      <Text selectable style={styles.bodyText}>
        {shown.map((line, index) => {
          let style;
          if (diff && line.startsWith("+")) style = styles.added;
          else if (diff && line.startsWith("-")) style = styles.removed;
          return (
            <Text key={index} style={style}>
              {line}
              {"\n"}
            </Text>
          );
        })}
        {hidden > 0 ? `… ${hidden} more lines` : ""}
      </Text>
    </View>
  );
}

function ToolRow({
  item,
  cwd,
  theme,
  styles,
}: {
  item: ToolCall;
  cwd: string;
  theme: Theme;
  styles: Styles;
}) {
  const [open, setOpen] = useState(false);
  const tool = describeTool(item, cwd);
  const body = tool.body?.trimEnd() || (item.status === "failed" ? String(item.error) : "");
  const { colors } = theme;
  const meta =
    item.status === "running"
      ? { label: "Running", color: colors.accent }
      : item.status === "failed"
        ? { label: "Failed", color: colors.statusDanger }
        : item.status === "canceled"
          ? { label: "Canceled", color: colors.foregroundMuted }
          : null;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${tool.title}${meta ? `, ${meta.label}` : ""}`}
        accessibilityState={{ expanded: open, disabled: !body }}
        disabled={!body}
        onPress={() => setOpen((value) => !value)}
        style={styles.row}
      >
        <Icon name={tool.icon} size={14} color={colors.foregroundMuted} />
        <Text numberOfLines={1} style={styles.rowTitle}>
          {firstLine(tool.title)}
        </Text>
        {meta ? <Text style={[styles.rowMeta, { color: meta.color }]}>{meta.label}</Text> : null}
        {body ? (
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={colors.foregroundMuted}
          />
        ) : null}
      </Pressable>
      {open && body ? <ToolBody text={body} diff={tool.diff} styles={styles} /> : null}
    </View>
  );
}

function SubagentCard({
  agent,
  theme,
  styles,
  navigation,
}: {
  agent: Agent;
  theme: Theme;
  styles: Styles;
  navigation: PluginSurfaceProps["navigation"];
}) {
  const paseo = usePaseo();
  const [open, setOpen] = useState(false);
  const busy = isBusy(agent);
  const timeline = useQuery(timelineQuery(paseo, agent));
  const stopRpc = useRpc(stopAgent);
  const queryClient = useQueryClient();
  const toast = useToast();
  const stopping = useMutation({
    mutationFn: () => stopRpc({ agentId: agent.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subagents"] }),
    onError: (error) => toast.error(`Could not stop ${title}. ${error.message}`),
  });
  const entries = timeline.data?.entries ?? [];
  const status = statusOf(agent, theme);
  const title = agent.title ?? `Agent ${agent.id.slice(0, 8)}`;
  const activity =
    (agent.status === "error" && agent.lastError) ||
    currentActivity(entries, agent.cwd) ||
    (timeline.isPending ? "Loading…" : "No activity yet");
  const work = entries
    .filter(({ item }) => item.type === "tool_call" || item.type === "assistant_message")
    .reverse();
  const model = agent.model ? `${agent.provider} · ${agent.model}` : agent.provider;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${status.label}. ${activity}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={styles.cardToggle}
        >
          <View style={[styles.dot, { backgroundColor: status.color }]} />
          <View style={styles.cardText}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <Text numberOfLines={open ? 3 : 1} style={styles.activity}>
              {activity}
            </Text>
          </View>
          <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            size={16}
            color={theme.colors.foregroundMuted}
          />
        </Pressable>
        {busy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Stop ${title}`}
            accessibilityState={{ disabled: stopping.isPending, busy: stopping.isPending }}
            disabled={stopping.isPending}
            hitSlop={8}
            onPress={() => stopping.mutate()}
            style={[styles.stop, stopping.isPending && styles.stopPending]}
          >
            <Icon name="Square" size={12} color={theme.colors.statusDanger} />
            <Text style={styles.stopText}>{stopping.isPending ? "Stopping…" : "Stop"}</Text>
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <View style={styles.work}>
          <View style={styles.workBar}>
            <Text numberOfLines={1} style={styles.summary}>
              {model}
            </Text>
            {navigation ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${title}`}
                hitSlop={12}
                onPress={() => navigation.openAgent({ agentId: agent.id })}
              >
                <Text style={styles.link}>Open agent</Text>
              </Pressable>
            ) : null}
          </View>
          {timeline.error ? (
            <Text style={[styles.said, styles.error]}>
              Could not load activity. {timeline.error.message}
            </Text>
          ) : null}
          {work.map(({ item, seqStart }) =>
            item.type === "tool_call" ? (
              <ToolRow key={seqStart} item={item} cwd={agent.cwd} theme={theme} styles={styles} />
            ) : item.type === "assistant_message" && item.text.trim() ? (
              <Text key={seqStart} numberOfLines={4} style={styles.said}>
                {item.text.trim()}
              </Text>
            ) : null,
          )}
          {timeline.data?.hasOlder ? (
            <Text style={styles.said}>Older activity is in the agent's own timeline.</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function TaskCard({
  task,
  parent,
  theme,
  styles,
}: {
  task: Task;
  parent: Agent;
  theme: Theme;
  styles: Styles;
}) {
  const [open, setOpen] = useState(false);
  const { colors } = theme;
  const { detail } = task;
  const title = detail.description ?? detail.subAgentType ?? task.name;
  const actions = [...(detail.actions ?? [])].reverse();
  const log = detail.log.trimEnd() || (task.status === "failed" ? String(task.error) : "");
  const status = isTaskBusy(task, parent)
    ? { label: "Running", color: colors.accent }
    : task.status === "failed"
      ? { label: "Error", color: colors.statusDanger }
      : task.status === "completed"
        ? { label: "Finished", color: colors.statusSuccess }
        : { label: "Stopped", color: colors.foregroundMuted };
  const latest = actions[0];
  const activity =
    (latest && firstLine(latest.summary ?? latest.toolName)) ||
    firstLine(log.split("\n").at(-1) ?? "") ||
    "No activity yet";

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${status.label}. ${activity}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={styles.cardToggle}
        >
          <View style={[styles.dot, { backgroundColor: status.color }]} />
          <View style={styles.cardText}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <Text numberOfLines={open ? 3 : 1} style={styles.activity}>
              {activity}
            </Text>
          </View>
          <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            size={16}
            color={colors.foregroundMuted}
          />
        </Pressable>
      </View>
      {open ? (
        <View style={styles.work}>
          <View style={styles.workBar}>
            <Text numberOfLines={1} style={styles.summary}>
              {parent.provider} · {detail.subAgentType ?? "subagent"}
            </Text>
          </View>
          {actions.map((action) => (
            <View key={action.index} style={styles.row}>
              <Icon name="Wrench" size={14} color={colors.foregroundMuted} />
              <Text numberOfLines={1} style={styles.rowTitle}>
                {firstLine(action.summary ? `${action.toolName} ${action.summary}` : action.toolName)}
              </Text>
            </View>
          ))}
          {log ? <ToolBody text={log} styles={styles} /> : null}
        </View>
      ) : null}
    </View>
  );
}

export function SubagentsPanel({
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
  // lazy: polls the agent directory (capped at 200 agents) while this screen is open.
  // Upgrade path: agents.list({ subscribe: {} }) and apply agent_update messages.
  const agents = useQuery({
    queryKey: ["subagents"],
    queryFn: () =>
      paseo.agents.list({
        filter: { includeArchived: false },
        sort: [{ key: "created_at", direction: "desc" }],
        page: { limit: 200 },
      }),
    refetchInterval: POLL_MS,
  });

  const all = agents.data?.entries.map((entry) => entry.agent) ?? [];
  const byId = new Map(all.map((agent) => [agent.id, agent]));
  const local = all.filter((agent) => agent.workspaceId === workspaceId);
  // lazy: only tasks in the last 100 timeline entries of each agent here are found.
  // Upgrade path: page older entries, or a daemon-side filter by tool call type.
  const timelines = useQueries({ queries: local.map((agent) => timelineQuery(paseo, agent)) });

  const byParent = new Map<string, { agents: Agent[]; tasks: Task[] }>();
  const groupOf = (parentId: string) => {
    let group = byParent.get(parentId);
    if (!group) byParent.set(parentId, (group = { agents: [], tasks: [] }));
    return group;
  };
  for (const agent of all) {
    const parentId = agent.labels[PARENT_LABEL];
    if (!parentId) continue;
    // A subagent belongs to this workspace if it or its parent runs here (it may get its own worktree).
    const here =
      agent.workspaceId === workspaceId || byId.get(parentId)?.workspaceId === workspaceId;
    if (here) groupOf(parentId).agents.push(agent);
  }
  local.forEach((agent, index) => {
    const tasks = (timelines[index].data?.entries ?? []).map((entry) => entry.item).filter(isTask);
    // Newest first, like the directory order.
    if (tasks.length > 0) groupOf(agent.id).tasks.push(...tasks.reverse());
  });
  const groups = [...byParent].map(([parentId, group]) => {
    const parent = byId.get(parentId);
    // Tasks only come from agents in the directory, so they always have a parent.
    const tasks = parent ? group.tasks.map((task) => ({ task, parent })) : [];
    return {
      parentId,
      title: parent?.title ?? `Agent ${parentId.slice(0, 8)}`,
      // Busy ones first; newest first is kept within each half.
      agents: [...group.agents.filter(isBusy), ...group.agents.filter((agent) => !isBusy(agent))],
      tasks: [
        ...tasks.filter(({ task, parent }) => isTaskBusy(task, parent)),
        ...tasks.filter(({ task, parent }) => !isTaskBusy(task, parent)),
      ],
    };
  });

  const total = groups.reduce((count, group) => count + group.agents.length + group.tasks.length, 0);
  const running = groups.reduce(
    (count, group) =>
      count +
      group.agents.filter(isBusy).length +
      group.tasks.filter(({ task, parent }) => isTaskBusy(task, parent)).length,
    0,
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {agents.error ? (
        <Text style={styles.error}>Could not load agents. {agents.error.message}</Text>
      ) : agents.isPending ? (
        <Text style={styles.message}>Loading subagents…</Text>
      ) : total === 0 ? (
        <Text style={styles.message}>
          No subagents in this workspace yet. Agents and tasks started by another agent show up
          here.
        </Text>
      ) : (
        <Text style={styles.summary}>
          {running} running · {total} total
        </Text>
      )}
      {groups.map((group) => (
        <View key={group.parentId} style={styles.group}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open parent agent ${group.title}`}
            disabled={!navigation}
            hitSlop={12}
            onPress={() => navigation?.openAgent({ agentId: group.parentId })}
            style={styles.groupHeader}
          >
            <Icon name="CornerDownRight" size={12} color={theme.colors.foregroundMuted} />
            <Text numberOfLines={1} style={styles.groupTitle}>
              {group.title}
            </Text>
          </Pressable>
          {group.tasks.map(({ task, parent }) => (
            <TaskCard key={task.callId} task={task} parent={parent} theme={theme} styles={styles} />
          ))}
          {group.agents.map((agent) => (
            <SubagentCard
              key={agent.id}
              agent={agent}
              theme={theme}
              styles={styles}
              navigation={navigation}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
