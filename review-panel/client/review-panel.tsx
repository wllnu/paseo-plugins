import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useAgent, usePaseo, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  REVIEW_DIR,
  listReviewsRpc,
  readReviewRpc,
  readStateRpc,
  writeStateRpc,
  type Finding,
  type FindingState,
  type ReviewState,
  type Severity,
} from "../shared/contracts";
import { describeCounts, endLineOf, isClosed, sortFindings, statusMap } from "../shared/findings";
import { buildFixPrompt } from "../shared/fix-prompt";
import { DiffView, type DiffTarget, type FileMarker } from "./diff-view";
import { FindingsList } from "./findings-list";
import { useSelection } from "./selection";
import { SendModal } from "./send-modal";
import { monoFont, type CodeReference } from "./ui";

export const REVIEW_PANEL_ID = "review";

const LIST_POLL_MS = 2000;
/** From this panel width the findings list and the diff sit side by side. */
const WIDE_MIN_WIDTH = 900;
const EMPTY_STATE: ReviewState = { findings: {} };

/** Paths in review files may be `./src/x.ts` or absolute; compare them as workspace-relative paths. */
function toWorkspacePath(directory: string | null, file: string): string {
  let clean = file.trim().replace(/\\/g, "/");
  if (directory && clean.startsWith(`${directory.replace(/\/$/, "")}/`)) clean = clean.slice(directory.replace(/\/$/, "").length + 1);
  return clean.replace(/^\.\//, "");
}

export function ReviewPanel({ theme, layout, workspaceId, agentId }: PluginAgentPanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const agent = useAgent(agentId, ({ status, title }) => ({ status, title }));
  const paseo = usePaseo();
  const toast = useToast();
  const queryClient = useQueryClient();
  const listReviews = useRpc(listReviewsRpc);
  const readReview = useRpc(readReviewRpc);
  const readState = useRpc(readStateRpc);
  const writeState = useRpc(writeStateRpc);

  const [chosenReview, setChosenReview] = useState<string | null>(null);
  const [target, setTarget] = useState<DiffTarget | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [width, setWidth] = useState(0);
  const wide = !layout.compact && width >= WIDE_MIN_WIDTH;

  const listQuery = useQuery({
    queryKey: ["review-panel", "reviews", directory],
    queryFn: () => listReviews({ directory: directory ?? "" }),
    enabled: Boolean(directory),
    refetchInterval: LIST_POLL_MS,
    placeholderData: keepPreviousData,
  });
  const reviews = listQuery.data?.reviews ?? [];
  const summary = reviews.find((review) => review.name === chosenReview) ?? reviews[0] ?? null;
  const reviewName = summary?.name ?? null;

  const reviewQuery = useQuery({
    queryKey: ["review-panel", "review", directory, reviewName, summary?.modifiedAt],
    queryFn: () => readReview({ directory: directory ?? "", name: reviewName ?? "" }),
    enabled: Boolean(directory && reviewName),
    staleTime: Number.POSITIVE_INFINITY,
    // Keep showing the review while the agent's rewrite loads, but never another review's findings.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[3] === reviewName ? previous : undefined),
  });
  const loaded = reviewQuery.data ?? null;
  const review = loaded?.review ?? null;

  const stateKey = useMemo(() => ["review-panel", "state", directory, reviewName] as const, [directory, reviewName]);
  const stateQuery = useQuery({
    queryKey: stateKey,
    queryFn: () => readState({ directory: directory ?? "", name: reviewName ?? "" }),
    enabled: Boolean(directory && reviewName),
  });
  const reviewState = stateQuery.data?.state ?? EMPTY_STATE;

  const saveState = useMutation({
    mutationFn: async ({ name, state }: { name: string; state: ReviewState }) => {
      if (!directory) throw new Error("Workspace is unavailable.");
      await writeState({ directory, name, state });
    },
    onMutate: ({ name, state }) => {
      queryClient.setQueryData(["review-panel", "state", directory, name], { state });
    },
    onError: (error, { name }) => {
      toast.error(error instanceof Error ? error.message : "Could not save the review state.");
      void queryClient.invalidateQueries({ queryKey: ["review-panel", "state", directory, name] });
    },
  });

  const findings = useMemo(() => sortFindings(review?.findings ?? []), [review]);
  const statuses = useMemo(() => statusMap(findings, reviewState), [findings, reviewState]);
  const knownFiles = useMemo(
    () => [...new Set(findings.flatMap((finding) => finding.locations.map((location) => toWorkspacePath(directory, location.file))))],
    [findings, directory],
  );

  const [rawSelected, setSelected] = useSelection(directory && reviewName ? `${directory}::${reviewName}` : null);
  // Drop ids the agent removed from the file and findings the user dismissed.
  const selected = useMemo(
    () => new Set([...rawSelected].filter((id) => statuses.has(id) && statuses.get(id) !== "dismissed")),
    [rawSelected, statuses],
  );
  const selectedFindings = useMemo(() => findings.filter((finding) => selected.has(finding.id)), [findings, selected]);

  useEffect(() => {
    setTarget(null);
  }, [reviewName]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
    },
    [selected, setSelected],
  );

  const toggleGroup = useCallback(
    (severity: Severity) => {
      const open = findings.filter((finding) => finding.severity === severity && !isClosed(statuses.get(finding.id) ?? "open"));
      const next = new Set(selected);
      const allSelected = open.every((finding) => next.has(finding.id));
      for (const finding of open) {
        if (allSelected) next.delete(finding.id);
        else next.add(finding.id);
      }
      setSelected(next);
    },
    [findings, selected, setSelected, statuses],
  );

  const patchFindings = useCallback(
    (patches: Record<string, Partial<FindingState>>) => {
      if (!reviewName) return;
      const next: ReviewState = { findings: { ...reviewState.findings } };
      for (const [id, patch] of Object.entries(patches)) next.findings[id] = { ...next.findings[id], ...patch };
      saveState.mutate({ name: reviewName, state: next });
    },
    [reviewName, reviewState, saveState],
  );

  const setDismissed = useCallback(
    (id: string, dismissed: boolean) => patchFindings({ [id]: { dismissed } }),
    [patchFindings],
  );

  const openLocation = useCallback(
    (finding: Finding, index: number) => {
      const location = finding.locations[index];
      if (!location) return;
      setTarget({
        findingId: finding.id,
        locationIndex: index,
        file: toWorkspacePath(directory, location.file),
        line: location.line,
        endLine: location.endLine ?? null,
        side: location.side,
      });
    },
    [directory],
  );

  const openReference = useCallback(
    (finding: Finding | null, reference: CodeReference) => {
      const file = toWorkspacePath(directory, reference.file);
      // A reference that points into one of the finding's own locations focuses that location.
      const index =
        finding?.locations.findIndex(
          (location) =>
            toWorkspacePath(directory, location.file) === file &&
            location.side === "new" &&
            reference.line >= location.line &&
            reference.line <= endLineOf(location),
        ) ?? -1;
      setTarget({
        findingId: finding?.id ?? null,
        locationIndex: index >= 0 ? index : null,
        file,
        line: reference.line,
        endLine: reference.endLine,
        side: "new",
      });
    },
    [directory],
  );

  const markers = useMemo<FileMarker[]>(() => {
    if (!target) return [];
    return findings.flatMap((finding) =>
      finding.locations
        .map((location, locationIndex) => ({ finding, location, locationIndex, status: statuses.get(finding.id) ?? "open" }))
        .filter(({ location }) => toWorkspacePath(directory, location.file) === target.file),
    );
  }, [findings, statuses, target, directory]);

  const focusedFinding = target?.findingId ? (findings.find((finding) => finding.id === target.findingId) ?? null) : null;
  const locationNav =
    focusedFinding && target?.locationIndex != null && focusedFinding.locations.length > 1
      ? {
          index: target.locationIndex,
          count: focusedFinding.locations.length,
          onStep: (delta: number) => {
            const count = focusedFinding.locations.length;
            openLocation(focusedFinding, ((target.locationIndex ?? 0) + delta + count) % count);
          },
        }
      : null;

  const hasAgent = agentId.length > 0;
  const agentStatus = agent?.status ?? "unknown";
  const agentTitle = agent?.title || "the agent";
  const canSend = hasAgent && selected.size > 0 && agentStatus !== "closed" && !sending;

  const sendFindings = useCallback(
    async (note: string, comments: Record<string, string>) => {
      if (!review || !reviewName || selectedFindings.length === 0) return;
      setSending(true);
      try {
        await paseo.agents.ref(agentId).send(buildFixPrompt({ reviewName, review, findings: selectedFindings, note, comments }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not send the findings to the agent.");
        setSending(false);
        return;
      }
      const sentAt = new Date().toISOString();
      patchFindings(Object.fromEntries(selectedFindings.map((finding) => [finding.id, { sentAt }])));
      setSelected(new Set());
      setSendOpen(false);
      setSending(false);
      const count = selectedFindings.length;
      toast.show(`Sent ${count === 1 ? "1 finding" : `${count} findings`} to ${agentTitle}`, { variant: "success" });
    },
    [agentId, agentTitle, paseo, patchFindings, review, reviewName, selectedFindings, setSelected, toast],
  );

  const styles = useMemo(() => {
    const pad = layout.compact ? 12 : 16;
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      header: {
        gap: 8,
        paddingHorizontal: pad,
        paddingTop: layout.compact ? 10 : 12,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
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
        maxWidth: 260,
      },
      chipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      chipText: { color: theme.colors.foreground, fontSize: 12, fontWeight: "600" as const },
      chipTextActive: { color: theme.colors.accentForeground },
      split: { flex: 1, flexDirection: wide ? ("row" as const) : ("column" as const) },
      listPane: wide
        ? { width: "42%" as const, minWidth: 340, maxWidth: 560, borderRightWidth: 1, borderRightColor: theme.colors.border }
        : { flex: 1 },
      diffPane: { flex: 1 },
      placeholder: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, gap: 8, padding: 24 },
      empty: { padding: pad, gap: 10 },
      emptyTitle: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
      emptyText: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
      code: { color: theme.colors.foreground, fontSize: 12, fontFamily: monoFont(layout.platform) },
      error: { color: theme.colors.statusDanger, fontSize: 13, lineHeight: 19 },
      problem: { color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: monoFont(layout.platform) },
      footer: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingHorizontal: pad,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      footerLeft: { flex: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: 8, minWidth: 0 },
      dot: { width: 8, height: 8, borderRadius: 4 },
      status: { flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: 12 },
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
    };
  }, [theme, layout.compact, layout.platform, wide]);

  const dotColor =
    agentStatus === "running"
      ? theme.colors.statusWarning
      : agentStatus === "error"
        ? theme.colors.statusDanger
        : agentStatus === "idle"
          ? theme.colors.statusSuccess
          : theme.colors.border;
  const openCount = findings.filter((finding) => !isClosed(statuses.get(finding.id) ?? "open")).length;
  const showDiff = target !== null && review !== null && directory !== null;

  let content: React.ReactNode;
  if (!directory) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Workspace is unavailable.</Text>
      </View>
    );
  } else if (listQuery.isError) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.error}>{listQuery.error instanceof Error ? listQuery.error.message : "Could not list reviews."}</Text>
      </View>
    );
  } else if (!listQuery.data) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Loading reviews…</Text>
      </View>
    );
  } else if (!summary) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No review yet</Text>
        <Text style={styles.emptyText}>
          This panel shows code review findings an agent writes to the workspace, grouped into blocking, should fix, and
          nitpicks. Tick findings to send them back for fixing, and open any file reference to see the diff behind it.
        </Text>
        <Text style={styles.emptyText}>Ask an agent to review with the paseo-review skill, for example:</Text>
        <Text style={styles.code}>/paseo-review the changes on this branch</Text>
        <Text style={styles.emptyText}>Reviews are read from:</Text>
        <Text style={styles.code}>{REVIEW_DIR}/*.json</Text>
      </View>
    );
  } else if (reviewQuery.isError) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.error}>{reviewQuery.error instanceof Error ? reviewQuery.error.message : "Could not read the review."}</Text>
      </View>
    );
  } else if (!loaded) {
    content = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Loading review…</Text>
      </View>
    );
  } else if (!review) {
    content = (
      <ScrollView contentContainerStyle={styles.empty}>
        <Text style={styles.emptyTitle}>This review file cannot be shown</Text>
        <Text style={styles.code}>
          {REVIEW_DIR}/{summary.name}
        </Text>
        {loaded.problems.map((problem, index) => (
          <Text key={index} style={styles.problem}>
            {problem}
          </Text>
        ))}
        <Text style={styles.emptyText}>Ask the agent to fix the file; the panel updates as soon as it is valid.</Text>
      </ScrollView>
    );
  } else {
    content = (
      <View style={styles.split}>
        <View style={[styles.listPane, showDiff && !wide ? { display: "none" } : null]}>
          <FindingsList
            theme={theme}
            compact={layout.compact}
            platform={layout.platform}
            review={review}
            problems={loaded.problems}
            findings={findings}
            statuses={statuses}
            selected={selected}
            activeFindingId={wide ? (target?.findingId ?? null) : null}
            knownFiles={knownFiles}
            onToggle={toggle}
            onToggleGroup={toggleGroup}
            onSetDismissed={setDismissed}
            onOpenLocation={openLocation}
            onOpenReference={openReference}
          />
        </View>
        {showDiff && target ? (
          <View style={styles.diffPane}>
            <DiffView
              key={target.file}
              theme={theme}
              compact={layout.compact}
              platform={layout.platform}
              directory={directory}
              scope={review.scope}
              target={target}
              markers={markers}
              selected={selected}
              knownFiles={knownFiles}
              locationNav={locationNav}
              onToggle={toggle}
              onFocus={openLocation}
              onOpenReference={openReference}
              onBack={wide ? undefined : () => setTarget(null)}
              onClose={wide ? () => setTarget(null) : undefined}
            />
          </View>
        ) : wide ? (
          <View style={styles.placeholder}>
            <Icon name="FileDiff" size={22} color={theme.colors.foregroundMuted} />
            <Text style={[styles.emptyText, { textAlign: "center" }]}>
              Open a file location on a finding to see the diff behind it.
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {showDiff && !wide ? null : (
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Icon name="SearchCheck" size={18} color={theme.colors.foreground} />
            <Text style={styles.title} numberOfLines={1}>
              {review?.title ?? summary?.title ?? "Review"}
            </Text>
            {review ? <Text style={styles.meta}>{openCount === findings.length ? `${findings.length} findings` : `${openCount} open`}</Text> : null}
          </View>
          {reviews.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {reviews.map((entry) => {
                const active = entry.name === reviewName;
                return (
                  <Pressable
                    key={entry.name}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${entry.title}, ${describeCounts(entry.counts)}`}
                    style={[styles.chip, active ? styles.chipActive : null]}
                    onPress={() => setChosenReview(entry.name)}
                  >
                    <Text style={[styles.chipText, active ? styles.chipTextActive : null]} numberOfLines={1}>
                      {entry.title}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      )}

      {content}

      {review ? (
        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <Text style={styles.status} numberOfLines={1}>
              {hasAgent ? `${agent?.title ?? "Agent"} · ${agentStatus}` : "No agent selected to send fixes to"}
              {selected.size > 0 ? ` · ${selected.size} selected` : ""}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send selected findings for fixing"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            style={[styles.primary, canSend ? null : styles.primaryDisabled]}
            onPress={() => setSendOpen(true)}
          >
            <Icon name="Send" size={15} color={theme.colors.accentForeground} />
            <Text style={styles.primaryText}>{selected.size > 0 ? `Fix ${selected.size}` : "Fix selected"}</Text>
          </Pressable>
        </View>
      ) : null}

      <SendModal
        open={sendOpen}
        onOpenChange={setSendOpen}
        theme={theme}
        platform={layout.platform}
        findings={selectedFindings}
        statuses={statuses}
        agentTitle={agentTitle}
        agentBusy={agentStatus === "running"}
        busy={sending}
        onSend={sendFindings}
      />
    </View>
  );
}
