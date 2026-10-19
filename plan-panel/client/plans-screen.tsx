import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { PLAN_DIR, listPlansRpc, type PlanSummary } from "../shared/contracts";
import { isRoadmapName } from "../shared/roadmap";
import { PlanViewer, type AgentSummary } from "./plan-panel";

export const PLANS_SCREEN_ID = "plans";
export const PLAN_PANEL_ID = "plan";

const LIST_POLL_MS = 5000;

interface WorkspacePlans {
  workspaceId: string;
  workspaceName: string;
  projectName: string;
  directory: string;
  agentId: string | null;
  agentTitle: string | null;
  plans: PlanSummary[];
}

export interface PlanScreenParams {
  workspaceId: string;
  directory: string;
  agentId: string;
  plan: string;
  title: string;
}

const AGENT_POLL_MS = 3000;

function useAgentSummary(agentId: string): AgentSummary | null {
  const paseo = usePaseo();
  const query = useQuery({
    queryKey: ["plan-panel", "agent", agentId],
    enabled: agentId.length > 0,
    refetchInterval: AGENT_POLL_MS,
    queryFn: async (): Promise<AgentSummary | null> => {
      const handle = paseo.agents.ref(agentId);
      await handle.refresh();
      const snapshot = handle.current();
      return snapshot
        ? {
            status: snapshot.status,
            title: snapshot.title,
            provider: snapshot.provider,
            model: snapshot.model,
            modeId: snapshot.currentModeId,
            thinkingOptionId: snapshot.thinkingOptionId ?? null,
          }
        : null;
    },
  });
  return query.data ?? null;
}

interface PlanScreenViewProps extends PluginScreenProps {
  onBack(): void;
  onOpenBesideAgent(): void;
}

function PlanScreenView({ theme, layout, navigation, params, onBack, onOpenBesideAgent }: PlanScreenViewProps) {
  const agentId = params.agentId ?? "";
  const agent = useAgentSummary(agentId);
  return (
    <PlanViewer
      theme={theme}
      layout={layout}
      navigation={navigation}
      workspaceId={params.workspaceId ?? null}
      directory={params.directory ?? null}
      agentId={agentId}
      agent={agent}
      initialPlan={params.plan}
      onBack={onBack}
      onOpenBesideAgent={onOpenBesideAgent}
    />
  );
}

function formatAge(modifiedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - modifiedAt) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

/** Screen title shown in the host header; falls back to "Plans" for the list. */
export function plansScreenTitle(params: Record<string, string>): string {
  return params.title && params.plan ? params.title : "Plans";
}

export function createPlansScreen(client: PluginClientContext) {
  const openList = () => client.openScreen({ screenId: PLANS_SCREEN_ID });
  const openPlan = (params: PlanScreenParams) => client.openScreen({ screenId: PLANS_SCREEN_ID, params: { ...params } });
  const openBesideAgent = (workspaceId: string, agentId: string | null) =>
    client.openPanel(PLAN_PANEL_ID, agentId ? { workspaceId, agentId } : { workspaceId });

  return function PlansScreen(props: PluginScreenProps) {
    const { params } = props;
    if (params.workspaceId && params.plan && params.directory) {
      const workspaceId = params.workspaceId;
      const agentId = params.agentId || null;
      return <PlanScreenView {...props} onBack={openList} onOpenBesideAgent={() => openBesideAgent(workspaceId, agentId)} />;
    }
    return <PlansList {...props} onOpen={openPlan} onOpenBesideAgent={openBesideAgent} />;
  };
}

interface PlansListProps extends PluginScreenProps {
  onOpen(params: PlanScreenParams): void;
  onOpenBesideAgent(workspaceId: string, agentId: string | null): void;
}

function PlansList({ theme, layout, onOpen, onOpenBesideAgent }: PlansListProps) {
  const paseo = usePaseo();
  const listPlans = useRpc(listPlansRpc);

  const query = useQuery({
    queryKey: ["plan-panel", "all-plans"],
    refetchInterval: LIST_POLL_MS,
    queryFn: async (): Promise<WorkspacePlans[]> => {
      const [workspaces, agents] = await Promise.all([paseo.workspaces.list(), paseo.agents.list()]);
      const bestAgent = new Map<string, { id: string; title: string | null; updatedAt: string }>();
      for (const entry of agents.entries) {
        const agent = entry.agent;
        if (!agent.workspaceId || agent.status === "closed") continue;
        const previous = bestAgent.get(agent.workspaceId);
        if (!previous || agent.updatedAt > previous.updatedAt) {
          bestAgent.set(agent.workspaceId, { id: agent.id, title: agent.title, updatedAt: agent.updatedAt });
        }
      }
      const groups = await Promise.all(
        workspaces.entries.map(async (workspace): Promise<WorkspacePlans | null> => {
          const directory = workspace.workspaceDirectory ?? workspace.projectRootPath;
          if (!directory || workspace.archivingAt) return null;
          try {
            const { plans } = await listPlans({ directory });
            if (plans.length === 0) return null;
            const agent = bestAgent.get(workspace.id) ?? null;
            return {
              workspaceId: workspace.id,
              workspaceName: workspace.title ?? workspace.name,
              projectName: workspace.projectDisplayName,
              directory,
              agentId: agent?.id ?? null,
              agentTitle: agent?.title ?? null,
              plans,
            };
          } catch (error) {
            console.error("plan-panel: could not list plans for", directory, error);
            return null;
          }
        }),
      );
      return groups
        .filter((group): group is WorkspacePlans => group !== null)
        .sort((a, b) => (b.plans[0]?.modifiedAt ?? 0) - (a.plans[0]?.modifiedAt ?? 0));
    },
  });

  const styles = useMemo(() => {
    const pad = layout.compact ? 16 : 24;
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: pad, gap: layout.compact ? 12 : 16, maxWidth: 820, width: "100%" as const, alignSelf: "center" as const },
      intro: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      cardHeader: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 2,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      workspace: { color: theme.colors.foreground, fontSize: 14, fontWeight: "700" as const },
      project: { color: theme.colors.foregroundMuted, fontSize: 12 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
      rowPressed: { backgroundColor: theme.colors.surface2 },
      rowDivider: { borderTopWidth: 1, borderTopColor: theme.colors.border },
      rowBody: { flex: 1, gap: 2, minWidth: 0 },
      planTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      planMeta: { color: theme.colors.foregroundMuted, fontSize: 12 },
      iconButton: { padding: 8, borderRadius: 8 },
      empty: { gap: 8, paddingVertical: 24, alignItems: "center" as const },
      emptyTitle: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
      emptyText: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19, textAlign: "center" as const },
      code: { color: theme.colors.foreground, fontSize: 12, fontFamily: layout.platform === "ios" ? "Menlo" : "monospace" },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
    };
  }, [theme, layout.compact, layout.platform]);

  const now = Date.now();
  const groups = query.data ?? [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        Plans written by agents in your workspaces. Open one to read it, comment on it, and send feedback to the agent.
      </Text>
      {query.isError ? (
        <Text style={styles.error}>{query.error instanceof Error ? query.error.message : "Could not load plans."}</Text>
      ) : null}
      {!query.isError && query.data && groups.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No plans yet</Text>
          <Text style={styles.emptyText}>Ask an agent to plan something with the paseo-plan skill. Plans are read from</Text>
          <Text style={styles.code}>{PLAN_DIR}/*.html</Text>
          <Text style={styles.emptyText}>inside each workspace.</Text>
        </View>
      ) : null}
      {!query.data && !query.isError ? <Text style={styles.intro}>Loading plans…</Text> : null}
      {groups.map((group) => (
        <View key={group.workspaceId} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.workspace} numberOfLines={1}>
              {group.workspaceName}
            </Text>
            <Text style={styles.project} numberOfLines={1}>
              {group.projectName}
              {group.agentTitle ? ` · ${group.agentTitle}` : group.agentId ? "" : " · no active agent"}
            </Text>
          </View>
          {group.plans.map((plan, index) => (
            <Pressable
              key={plan.name}
              accessibilityRole="button"
              accessibilityLabel={`Open plan ${plan.title}`}
              style={({ pressed }) => [styles.row, index > 0 ? styles.rowDivider : null, pressed ? styles.rowPressed : null]}
              onPress={() =>
                onOpen({
                  workspaceId: group.workspaceId,
                  directory: group.directory,
                  agentId: group.agentId ?? "",
                  plan: plan.name,
                  title: plan.title,
                })
              }
            >
              <Icon name={isRoadmapName(plan.name) ? "ListTree" : "ClipboardList"} size={18} color={theme.colors.foregroundMuted} />
              <View style={styles.rowBody}>
                <Text style={styles.planTitle} numberOfLines={1}>
                  {plan.title}
                </Text>
                <Text style={styles.planMeta} numberOfLines={1}>
                  {plan.name} · {formatAge(plan.modifiedAt, now)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open beside the agent"
                style={({ pressed }) => [styles.iconButton, pressed ? styles.rowPressed : null]}
                onPress={() => onOpenBesideAgent(group.workspaceId, group.agentId)}
              >
                <Icon name="PanelRight" size={16} color={theme.colors.foregroundMuted} />
              </Pressable>
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
