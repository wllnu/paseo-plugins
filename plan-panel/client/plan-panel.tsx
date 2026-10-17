import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useAgent, usePaseo, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  PLAN_DIR,
  listPlansRpc,
  readCommentsRpc,
  readPlanRpc,
  writeCommentsRpc,
  type PlanComment,
  type PlanLocator,
  type PlanLocatorBase,
} from "../shared/contracts";
import { buildFeedbackPrompt, locatorBlocks } from "../shared/feedback";
import { parseHtml, readPlanDocument } from "../shared/html";
import { CommentModal } from "./comment-modal";
import { CommentsModal } from "./comments-modal";
import { PlanView } from "./plan-view";
import {
  clearPlanSelection,
  subscribeToPlanSelection,
  supportsTextSelection,
  type PlanTextSelection,
} from "./web";

const PLAN_POLL_MS = 2000;
/** Approximate rendered width of the floating selection toolbar, used to keep it inside the plan. */
const TOOLBAR_WIDTH = 220;

function newCommentId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface AgentSummary {
  status: "initializing" | "idle" | "running" | "error" | "closed";
  title: string | null;
}

export interface PlanViewerProps {
  theme: PluginAgentPanelProps["theme"];
  layout: PluginAgentPanelProps["layout"];
  /** Workspace directory containing `.paseo/plans`; null while unknown. */
  directory: string | null;
  /** Agent that receives feedback; empty string when the workspace has no active agent. */
  agentId: string;
  /** Live status of that agent, or null when unavailable. */
  agent: AgentSummary | null;
  /** Plan file name to show first; defaults to the most recently modified plan. */
  initialPlan?: string | null;
  /** When set, a back link to the Plans list is shown above the title. */
  onBack?: () => void;
  /** When set, a button opens this plan as a workspace tab beside the agent. */
  onOpenBesideAgent?: () => void;
}

/** Workspace panel entry: reads workspace and agent state with the panel-only hooks. */
export function PlanPanel({ theme, layout, workspaceId, agentId }: PluginAgentPanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const agent = useAgent(agentId, ({ status, title }) => ({ status, title }));
  return <PlanViewer theme={theme} layout={layout} directory={directory} agentId={agentId} agent={agent} />;
}

/** Hook-free plan viewer shared by the workspace panel and the Plans screen. */
export function PlanViewer({ theme, layout, directory, agentId, agent, initialPlan, onBack, onOpenBesideAgent }: PlanViewerProps) {
  const hasAgent = agentId.length > 0;
  const paseo = usePaseo();
  const toast = useToast();
  const queryClient = useQueryClient();
  const listPlans = useRpc(listPlansRpc);
  const readPlan = useRpc(readPlanRpc);
  const readComments = useRpc(readCommentsRpc);
  const writeComments = useRpc(writeCommentsRpc);

  const [chosenPlan, setChosenPlan] = useState<string | null>(initialPlan ?? null);
  const [composer, setComposer] = useState<{ open: boolean; locator: PlanLocator | null; fromRail: boolean }>({
    open: false,
    locator: null,
    fromRail: false,
  });
  const [listOpen, setListOpen] = useState(false);
  // Blocks selected in the comment rail, by locator key. Separate from the plan's own interactions.
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [sending, setSending] = useState(false);
  const [selection, setSelection] = useState<PlanTextSelection | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const registry = useRef(new Map<string, PlanLocatorBase>()).current;
  const instanceId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const containerId = `plan-root-${instanceId}`;
  const toolbarId = `plan-selection-toolbar-${instanceId}`;
  const textSelection = supportsTextSelection();

  const plansQuery = useQuery({
    queryKey: ["plan-panel", "plans", directory],
    queryFn: () => listPlans({ directory: directory ?? "" }),
    enabled: Boolean(directory),
    refetchInterval: PLAN_POLL_MS,
    placeholderData: keepPreviousData,
  });
  const plans = plansQuery.data?.plans ?? [];
  const selectedPlan = plans.find((plan) => plan.name === chosenPlan) ?? plans[0] ?? null;

  const planQuery = useQuery({
    queryKey: ["plan-panel", "plan", directory, selectedPlan?.name, selectedPlan?.modifiedAt],
    queryFn: () => readPlan({ directory: directory ?? "", name: selectedPlan?.name ?? "" }),
    enabled: Boolean(directory && selectedPlan),
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: keepPreviousData,
  });
  const html = planQuery.data?.html;
  const planDoc = useMemo(() => (html === undefined ? null : readPlanDocument(parseHtml(html))), [html]);

  const commentsKey = ["plan-panel", "comments", directory, selectedPlan?.name] as const;
  const commentsQuery = useQuery({
    queryKey: commentsKey,
    queryFn: () => readComments({ directory: directory ?? "", name: selectedPlan?.name ?? "" }),
    enabled: Boolean(directory && selectedPlan),
  });
  const comments = useMemo(() => commentsQuery.data?.comments ?? [], [commentsQuery.data]);
  const pendingComments = useMemo(() => comments.filter((comment) => comment.status === "pending"), [comments]);
  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const comment of comments) {
      if (!comment.locator) continue;
      for (const block of locatorBlocks(comment.locator)) counts[block.key] = (counts[block.key] ?? 0) + 1;
    }
    return counts;
  }, [comments]);

  const saveComments = useMutation({
    mutationFn: async (next: PlanComment[]) => {
      if (!directory || !selectedPlan) throw new Error("No plan selected.");
      await writeComments({ directory, name: selectedPlan.name, comments: next });
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(commentsKey, { comments: next });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save comments.");
    },
  });

  const openComposer = useCallback((locator: PlanLocator | null, fromRail = false) => {
    setSelection(null);
    setComposer({ open: true, locator, fromRail });
  }, []);

  /** Comment on every block selected in the rail: the first is the locator, the rest ride along in document order. */
  const commentOnRailSelection = useCallback(() => {
    // The registry iterates in document order and only holds blocks of the current plan revision.
    const blocks = [...registry.values()].filter((block) => selectedKeys.has(block.key));
    const [first, ...others] = blocks;
    if (!first) {
      setSelectedKeys(new Set());
      return;
    }
    openComposer({ ...first, selectedText: null, end: null, others }, true);
  }, [openComposer, registry, selectedKeys]);

  useEffect(() => {
    if (!textSelection || !planDoc) return;
    return subscribeToPlanSelection(containerId, toolbarId, {
      onSelect: setSelection,
      onDismiss: () => setSelection(null),
    });
  }, [textSelection, planDoc, containerId, toolbarId]);

  const commentOnSelection = useCallback(() => {
    if (!selection) return;
    const start = selection.startKey ? registry.get(selection.startKey) : undefined;
    const end = selection.endKey ? registry.get(selection.endKey) : undefined;
    const base: PlanLocatorBase = start ??
      end ?? {
        key: "selection",
        elementId: null,
        anchorId: null,
        headings: [],
        tag: "selection",
        ordinal: 1,
        excerpt: selection.text.length > 160 ? `${selection.text.slice(0, 157)}…` : selection.text,
      };
    const locator: PlanLocator = {
      ...base,
      selectedText: selection.text,
      end: end && end.key !== base.key ? end : null,
      others: [],
    };
    clearPlanSelection();
    openComposer(locator);
  }, [openComposer, registry, selection]);

  const addComment = useCallback(
    async (text: string) => {
      const comment: PlanComment = {
        id: newCommentId(),
        createdAt: new Date().toISOString(),
        text,
        locator: composer.locator,
        revision: planDoc?.revision ?? null,
        status: "pending",
        sentAt: null,
      };
      await saveComments.mutateAsync([...comments, comment]);
      if (composer.fromRail) setSelectedKeys(new Set());
    },
    [comments, composer.fromRail, composer.locator, planDoc?.revision, saveComments],
  );

  const deleteComment = useCallback(
    (id: string) => void saveComments.mutateAsync(comments.filter((comment) => comment.id !== id)),
    [comments, saveComments],
  );

  const clearSent = useCallback(
    () => void saveComments.mutateAsync(comments.filter((comment) => comment.status === "pending")),
    [comments, saveComments],
  );

  const sendFeedback = useCallback(async () => {
    if (!selectedPlan || !planDoc || pendingComments.length === 0 || sending || !hasAgent) return;
    setSending(true);
    try {
      const prompt = buildFeedbackPrompt({
        planName: selectedPlan.name,
        planTitle: planDoc.title,
        revision: planDoc.revision,
        comments: pendingComments,
      });
      await paseo.agents.ref(agentId).send(prompt);
      const sentAt = new Date().toISOString();
      await saveComments.mutateAsync(
        comments.map((comment) => (comment.status === "pending" ? { ...comment, status: "sent", sentAt } : comment)),
      );
      toast.show(
        pendingComments.length === 1 ? "Sent 1 comment to the agent" : `Sent ${pendingComments.length} comments to the agent`,
        { variant: "success" },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send feedback to the agent.");
    } finally {
      setSending(false);
    }
  }, [agentId, comments, hasAgent, planDoc, paseo, pendingComments, saveComments, selectedPlan, sending, toast]);

  const styles = useMemo(() => {
    const pad = layout.compact ? 12 : 20;
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      header: {
        paddingHorizontal: pad,
        paddingTop: layout.compact ? 10 : 14,
        paddingBottom: 10,
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      backRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, alignSelf: "flex-start" as const, paddingVertical: 2 },
      backText: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      iconButton: { padding: 6, borderRadius: 8 },
      iconButtonPressed: { backgroundColor: theme.colors.surface2 },
      title: { flex: 1, color: theme.colors.foreground, fontSize: layout.compact ? 15 : 16, fontWeight: "700" as const },
      meta: { color: theme.colors.foregroundMuted, fontSize: 12 },
      chips: { flexDirection: "row" as const, gap: 6 },
      chip: {
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      chipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      chipText: { color: theme.colors.foreground, fontSize: 12, fontWeight: "600" as const },
      chipTextActive: { color: theme.colors.accentForeground },
      body: { flex: 1 },
      // The comment rail on the right of the plan already leaves a margin, so less padding is needed there.
      bodyContent: { paddingLeft: pad, paddingRight: Math.max(4, pad - 12), paddingVertical: layout.compact ? 12 : 16, paddingBottom: 32 },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17, marginBottom: 12 },
      empty: { padding: pad, gap: 10 },
      emptyTitle: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
      emptyText: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
      code: { color: theme.colors.foreground, fontSize: 12, fontFamily: layout.platform === "ios" ? "Menlo" : "monospace" },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      footer: {
        flexDirection: layout.compact ? ("column" as const) : ("row" as const),
        alignItems: layout.compact ? ("stretch" as const) : ("center" as const),
        gap: 8,
        paddingHorizontal: pad,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      footerLeft: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flex: 1 },
      status: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
      buttons: { flexDirection: "row" as const, gap: 8, justifyContent: "flex-end" as const },
      secondary: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      secondaryText: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      primary: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
      },
      primaryDisabled: { opacity: 0.45 },
      primaryText: { color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
      dot: { width: 8, height: 8, borderRadius: 4 },
      selectionBar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: pad,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      selectionText: { flex: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      planContainer: { position: "relative" as const },
      toolbar: {
        position: "absolute" as const,
        zIndex: 10,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        padding: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      toolbarPrimary: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 7,
        backgroundColor: theme.colors.accent,
      },
      toolbarPrimaryText: { color: theme.colors.accentForeground, fontSize: 12, fontWeight: "600" as const },
      toolbarDismiss: { padding: 6, borderRadius: 7 },
    };
  }, [theme, layout.compact, layout.platform]);

  const agentStatus = agent?.status ?? "unknown";
  const dotColor =
    agentStatus === "running"
      ? theme.colors.statusWarning
      : agentStatus === "error"
        ? theme.colors.statusDanger
        : agentStatus === "idle"
          ? theme.colors.statusSuccess
          : theme.colors.border;
  const canSend = hasAgent && pendingComments.length > 0 && !sending && agentStatus !== "closed";

  const metaParts: string[] = [];
  if (planDoc?.revision) metaParts.push(`rev ${planDoc.revision}`);
  if (planDoc?.status) metaParts.push(planDoc.status);
  if (comments.length > 0) metaParts.push(`${comments.length} comment${comments.length === 1 ? "" : "s"}`);

  let content: React.ReactNode;
  if (!directory) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Workspace is unavailable.</Text>
      </View>
    );
  } else if (plansQuery.isError) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.error}>{plansQuery.error instanceof Error ? plansQuery.error.message : "Could not list plans."}</Text>
      </View>
    );
  } else if (!plansQuery.data) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Loading plans…</Text>
      </View>
    );
  } else if (!selectedPlan) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No plan yet</Text>
        <Text style={styles.emptyText}>
          This panel shows HTML plans the agent writes to the workspace and lets you comment on any part of them.
        </Text>
        <Text style={styles.emptyText}>Ask the agent to plan with the paseo-plan skill, for example:</Text>
        <Text style={styles.code}>/paseo-plan add a notification system for finished uploads</Text>
        <Text style={styles.emptyText}>Plans are read from:</Text>
        <Text style={styles.code}>{PLAN_DIR}/*.html</Text>
      </View>
    );
  } else if (planQuery.isError) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.error}>{planQuery.error instanceof Error ? planQuery.error.message : "Could not read the plan."}</Text>
      </View>
    );
  } else if (!planDoc) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Loading plan…</Text>
      </View>
    );
  } else {
    content = (
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <Text style={styles.hint}>
          {textSelection
            ? "To comment, select blocks in the rail on the right (shift-click selects a range), or highlight text to comment on exactly that passage."
            : "To comment, tap the rail on the right of one or more blocks."}
        </Text>
        <View
          nativeID={containerId}
          style={styles.planContainer}
          onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
        >
          <PlanView
            key={selectedPlan?.name}
            body={planDoc.body}
            revision={planDoc.revision}
            theme={theme}
            compact={layout.compact}
            commentCounts={commentCounts}
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            registry={registry}
          />
          {selection ? (
            <View
              nativeID={toolbarId}
              style={[
                styles.toolbar,
                {
                  top: selection.rect.bottom + 8,
                  left: Math.max(0, Math.min(selection.rect.left, Math.max(0, containerWidth - TOOLBAR_WIDTH))),
                },
              ]}
            >
              <Pressable accessibilityRole="button" style={styles.toolbarPrimary} onPress={commentOnSelection}>
                <Icon name="MessageSquarePlus" size={14} color={theme.colors.accentForeground} />
                <Text style={styles.toolbarPrimaryText}>Comment on selection</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
                style={styles.toolbarDismiss}
                onPress={() => {
                  clearPlanSelection();
                  setSelection(null);
                }}
              >
                <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {onBack ? (
          <Pressable accessibilityRole="button" style={styles.backRow} onPress={onBack}>
            <Icon name="ChevronLeft" size={14} color={theme.colors.foregroundMuted} />
            <Text style={styles.backText}>All plans</Text>
          </Pressable>
        ) : null}
        <View style={styles.titleRow}>
          <Icon name="ClipboardList" size={18} color={theme.colors.foreground} />
          <Text style={styles.title} numberOfLines={1}>
            {planDoc?.title ?? selectedPlan?.title ?? "Plan"}
          </Text>
          {metaParts.length > 0 ? <Text style={styles.meta}>{metaParts.join(" · ")}</Text> : null}
          {onOpenBesideAgent ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open beside the agent"
              style={({ pressed }) => [styles.iconButton, pressed ? styles.iconButtonPressed : null]}
              onPress={onOpenBesideAgent}
            >
              <Icon name="PanelRight" size={16} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
        {plans.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {plans.map((plan) => {
              const active = plan.name === selectedPlan?.name;
              return (
                <Pressable
                  key={plan.name}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => {
                    setChosenPlan(plan.name);
                    setSelectedKeys(new Set());
                  }}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]} numberOfLines={1}>
                    {plan.title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {content}

      {planDoc && selectedKeys.size > 0 ? (
        <View style={styles.selectionBar}>
          <Icon name="ListChecks" size={16} color={theme.colors.accent} />
          <Text style={styles.selectionText} numberOfLines={1}>
            {selectedKeys.size === 1 ? "1 block selected" : `${selectedKeys.size} blocks selected`}
          </Text>
          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setSelectedKeys(new Set())}>
            <Icon name="X" size={15} color={theme.colors.foreground} />
            <Text style={styles.secondaryText}>Clear</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.primary} onPress={commentOnRailSelection}>
            <Icon name="MessageSquarePlus" size={15} color={theme.colors.accentForeground} />
            <Text style={styles.primaryText}>Comment</Text>
          </Pressable>
        </View>
      ) : null}

      {selectedPlan ? (
        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <Text style={styles.status} numberOfLines={1}>
              {hasAgent ? `${agent?.title ?? "Agent"} · ${agentStatus}` : "No active agent in this workspace to send feedback to"}
              {pendingComments.length > 0 ? ` · ${pendingComments.length} pending` : ""}
            </Text>
          </View>
          <View style={styles.buttons}>
            <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setListOpen(true)}>
              <Icon name="MessageSquareText" size={15} color={theme.colors.foreground} />
              <Text style={styles.secondaryText}>{comments.length > 0 ? `Comments (${comments.length})` : "Comments"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => openComposer(null)}>
              <Icon name="MessageSquarePlus" size={15} color={theme.colors.foreground} />
              <Text style={styles.secondaryText}>General</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              style={[styles.primary, canSend ? null : styles.primaryDisabled]}
              onPress={() => void sendFeedback()}
            >
              <Icon name="Send" size={15} color={theme.colors.accentForeground} />
              <Text style={styles.primaryText}>
                {sending ? "Sending…" : pendingComments.length > 0 ? `Send ${pendingComments.length}` : "Send"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <CommentModal
        open={composer.open}
        onOpenChange={(open) => setComposer((current) => ({ ...current, open }))}
        locator={composer.locator}
        theme={theme}
        busy={saveComments.isPending}
        onSubmit={addComment}
      />
      <CommentsModal
        open={listOpen}
        onOpenChange={setListOpen}
        comments={comments}
        theme={theme}
        onDelete={deleteComment}
        onClearSent={clearSent}
        onJumpTo={(comment) =>
          setSelectedKeys(new Set(comment.locator ? locatorBlocks(comment.locator).map((block) => block.key) : []))
        }
      />
    </View>
  );
}
