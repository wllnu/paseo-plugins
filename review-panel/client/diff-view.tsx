import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type ScrollView as NativeScrollView } from "react-native";
import {
  DEFAULT_CONTEXT,
  MORE_CONTEXT,
  WHOLE_FILE_CONTEXT,
  fileDiffRpc,
  type DiffLine,
  type FileDiff,
  type Finding,
  type FindingLocation,
  type ReviewScope,
} from "../shared/contracts";
import { endLineOf, formatLines, isClosed, shortRef, type FindingStatus } from "../shared/findings";
import { Checkbox, LinkedText, StatusChip, Tint, monoFont, severityColor, type CodeReference, type Platform } from "./ui";

/** What the diff view is pointed at: a finding's location, or a `path:line` reference from finding text. */
export interface DiffTarget {
  findingId: string | null;
  locationIndex: number | null;
  file: string;
  line: number;
  endLine: number | null;
  side: "new" | "old";
}

/** One finding location inside the file on screen; rendered as an inline card after its last line. */
export interface FileMarker {
  finding: Finding;
  locationIndex: number;
  location: FindingLocation;
  status: FindingStatus;
}

export interface DiffViewProps {
  theme: PluginTheme;
  compact: boolean;
  platform: Platform;
  directory: string;
  scope: ReviewScope;
  target: DiffTarget;
  markers: readonly FileMarker[];
  selected: ReadonlySet<string>;
  knownFiles: readonly string[];
  /** Step through the focused finding's locations. */
  locationNav: { index: number; count: number; onStep(delta: number): void } | null;
  onToggle(id: string): void;
  onFocus(finding: Finding, locationIndex: number): void;
  onOpenReference(finding: Finding | null, reference: CodeReference): void;
  /** Narrow layouts: back to the findings list. */
  onBack?: () => void;
  /** Wide layouts: close the diff pane. */
  onClose?: () => void;
}

type Row =
  | { type: "hunk"; key: string; label: string }
  | { type: "line"; key: string; line: DiffLine; target: boolean; stripe: string | null }
  | { type: "marker"; key: string; marker: FileMarker };

const STATUS_LABEL: Record<FileDiff["status"], string> = {
  modified: "modified",
  added: "new file",
  deleted: "deleted",
  unchanged: "not in diff",
  binary: "binary",
  missing: "missing",
};

function lineOn(line: DiffLine, side: "new" | "old"): number | null {
  return side === "new" ? line.newLine : line.oldLine;
}

function inRange(line: DiffLine, side: "new" | "old", start: number, end: number): boolean {
  const number = lineOn(line, side);
  return number !== null && number >= start && number <= end;
}

function buildRows(diff: FileDiff, target: DiffTarget, markers: readonly FileMarker[], theme: PluginTheme) {
  const targetEnd = endLineOf(target);
  const lines: Array<Extract<Row, { type: "line" }> | Extract<Row, { type: "hunk" }>> = [];
  const wholeFile = diff.hunks.length === 1 && (diff.hunks[0]?.oldStart ?? 0) <= 1 && (diff.hunks[0]?.newStart ?? 0) <= 1;
  diff.hunks.forEach((hunk, hunkIndex) => {
    if (!wholeFile) {
      lines.push({
        type: "hunk",
        key: `h${hunkIndex}`,
        label: `@@ -${hunk.oldStart} +${hunk.newStart} @@${hunk.section ? `  ${hunk.section}` : ""}`,
      });
    }
    hunk.lines.forEach((line, lineIndex) => {
      const stripeMarker = markers.find((marker) =>
        inRange(line, marker.location.side, marker.location.line, endLineOf(marker.location)),
      );
      lines.push({
        type: "line",
        key: `l${hunkIndex}-${lineIndex}`,
        line,
        target: inRange(line, target.side, target.line, targetEnd),
        stripe: stripeMarker ? severityColor(theme, stripeMarker.finding.severity) : null,
      });
    });
  });

  // Each marker goes after the last visible line of its range, like an inline review comment. For removed
  // code that is the last deleted line: git may pair a trailing old line (often a lone `}`) with a context
  // line far below, and the card belongs next to the deletion.
  const after = new Map<number, FileMarker[]>();
  const unplaced: FileMarker[] = [];
  for (const marker of markers) {
    const { side, line } = marker.location;
    const end = endLineOf(marker.location);
    let anchor = -1;
    let deletion = -1;
    lines.forEach((row, index) => {
      if (row.type !== "line" || !inRange(row.line, side, line, end)) return;
      anchor = index;
      if (row.line.kind === "del") deletion = index;
    });
    if (side === "old" && deletion >= 0) anchor = deletion;
    if (anchor < 0) unplaced.push(marker);
    else after.set(anchor, [...(after.get(anchor) ?? []), marker]);
  }
  const rows: Row[] = [];
  lines.forEach((row, index) => {
    rows.push(row);
    for (const marker of after.get(index) ?? []) {
      rows.push({ type: "marker", key: `m${marker.finding.id}-${marker.locationIndex}`, marker });
    }
  });

  const targetRows = lines.filter((row): row is Extract<Row, { type: "line" }> => row.type === "line" && row.target);
  const maxLine = lines.reduce(
    (max, row) => (row.type === "line" ? Math.max(max, row.line.oldLine ?? 0, row.line.newLine ?? 0) : max),
    0,
  );
  return {
    rows,
    unplaced,
    covered: targetRows.length > 0,
    inChange: targetRows.some((row) => row.line.kind !== "context"),
    gutterDigits: Math.max(2, String(maxLine).length),
  };
}

export function DiffView(props: DiffViewProps) {
  const { theme, compact, platform, directory, scope, target, markers } = props;
  const [context, setContext] = useState(DEFAULT_CONTEXT);
  const fileDiff = useRpc(fileDiffRpc);
  const head = scope.head ?? null;
  const query = useQuery({
    queryKey: ["review-panel", "diff", directory, scope.base, head, target.file, context],
    queryFn: () => fileDiff({ directory, base: scope.base, head, file: target.file, context }),
    // A working-tree review changes while the agent fixes things; a commit range never does.
    refetchInterval: head ? false : 5000,
    staleTime: head ? Number.POSITIVE_INFINITY : 0,
    placeholderData: keepPreviousData,
  });
  const diff = query.data;

  const built = useMemo(() => (diff ? buildRows(diff, target, markers, theme) : null), [diff, target, markers, theme]);

  // Lines outside the default hunks: widen to the whole file so the finding is still on screen.
  const needsWholeFile = Boolean(
    diff && built && !query.isPlaceholderData && !built.covered && diff.status === "modified" && context < WHOLE_FILE_CONTEXT,
  );
  useEffect(() => {
    if (needsWholeFile) setContext(WHOLE_FILE_CONTEXT);
  }, [needsWholeFile]);

  const scrollRef = useRef<NativeScrollView>(null);
  const targetKey = `${target.file}:${target.side}:${target.line}:${target.endLine ?? ""}:${target.findingId ?? ""}:${target.locationIndex ?? ""}`;
  const scrolledFor = useRef<string | null>(null);
  const firstTargetKey = built?.rows.find((row) => row.type === "line" && row.target)?.key ?? null;
  const onTargetLayout = (y: number) => {
    if (scrolledFor.current === targetKey) return;
    scrolledFor.current = targetKey;
    // Instant: a smooth scroll gets cut short when a poll re-renders the diff mid-animation.
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 72), animated: false });
  };

  const styles = useMemo(() => {
    const pad = compact ? 10 : 14;
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      header: {
        gap: 6,
        paddingHorizontal: pad,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      back: { flexDirection: "row" as const, alignItems: "center" as const, gap: 2, alignSelf: "flex-start" as const },
      backText: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      path: { flex: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const, fontFamily: monoFont(platform) },
      badge: { color: theme.colors.foregroundMuted, fontSize: 11 },
      sub: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 },
      tool: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      toolText: { color: theme.colors.foreground, fontSize: 11, fontWeight: "600" as const },
      iconButton: { padding: 4, borderRadius: 6 },
      content: { paddingVertical: 6, paddingBottom: 40 },
      banner: {
        marginHorizontal: pad,
        marginVertical: 6,
        padding: 9,
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.accent,
        backgroundColor: theme.colors.surface1,
      },
      bannerText: { color: theme.colors.foreground, fontSize: 12, lineHeight: 17 },
      message: { padding: pad, gap: 8 },
      messageText: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
      error: { color: theme.colors.statusDanger, fontSize: 13, lineHeight: 19 },
      hunk: {
        paddingHorizontal: pad,
        paddingVertical: 4,
        marginTop: 6,
        backgroundColor: theme.colors.surface1,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: theme.colors.border,
      },
      hunkText: { color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: monoFont(platform) },
    };
  }, [theme, compact, platform]);

  const nav = props.locationNav;
  const ranged = endLineOf(target) > target.line;
  const lineLabel = `${target.side === "old" ? "Removed line" : "Line"}${ranged ? "s" : ""} ${formatLines(target)}`;
  const verb = ranged ? "are" : "is";
  const focusedSeverity = markers.find((marker) => marker.finding.id === target.findingId)?.finding.severity ?? null;

  let banner: string | null = null;
  if (diff && built) {
    const where = head ? `commit ${shortRef(head)}` : "the working tree";
    if (diff.status === "unchanged") banner = `This file is not part of the reviewed diff. Showing it as it is in ${where}.`;
    else if (needsWholeFile || (query.isFetching && query.isPlaceholderData)) banner = "Loading more of the file…";
    else if (!built.covered && diff.hunks.length > 0)
      banner = `${lineLabel} ${verb} not in the file as it is in ${where}. The code may have changed since the review.`;
    else if (built.covered && !built.inChange && diff.status === "modified")
      banner = `${lineLabel} ${verb} unchanged in this diff. The finding is about code around the change.`;
  }

  let body: React.ReactNode;
  if (query.isError && !diff) {
    body = (
      <View style={styles.message}>
        <Text style={styles.error}>{query.error instanceof Error ? query.error.message : "Could not load the diff."}</Text>
        <Pressable accessibilityRole="button" style={[styles.tool, { alignSelf: "flex-start" }]} onPress={() => void query.refetch()}>
          <Text style={styles.toolText}>Retry</Text>
        </Pressable>
      </View>
    );
  } else if (!diff || !built) {
    body = (
      <View style={styles.message}>
        <Text style={styles.messageText}>Loading diff…</Text>
      </View>
    );
  } else if (diff.status === "binary" || diff.status === "missing") {
    body = (
      <View style={styles.message}>
        <Text style={styles.messageText}>
          {diff.status === "binary"
            ? "This is a binary file; there is no text diff to show."
            : `${target.file} does not exist ${head ? `at commit ${shortRef(head)}` : "in the working tree"}.`}
        </Text>
      </View>
    );
  } else {
    const gutterWidth = built.gutterDigits * 7.5 + 10;
    body = (
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {banner ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{banner}</Text>
          </View>
        ) : null}
        {diff.truncated ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Long diff: only the first 4000 lines are shown.</Text>
          </View>
        ) : null}
        {built.unplaced.length > 0 ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Also in this file, outside the lines shown:{" "}
              {built.unplaced.map((marker, index) => (
                <Text
                  key={`${marker.finding.id}-${marker.locationIndex}`}
                  style={{ color: theme.colors.accent, fontWeight: "600" }}
                  onPress={() => props.onFocus(marker.finding, marker.locationIndex)}
                >
                  {index > 0 ? ", " : ""}
                  {marker.finding.id} (line {marker.location.line})
                </Text>
              ))}
            </Text>
          </View>
        ) : null}
        {built.rows.map((row) => {
          if (row.type === "hunk") {
            return (
              <View key={row.key} style={styles.hunk}>
                <Text style={styles.hunkText} numberOfLines={1}>
                  {row.label}
                </Text>
              </View>
            );
          }
          if (row.type === "marker") {
            const { marker } = row;
            const focused = marker.finding.id === target.findingId && marker.locationIndex === target.locationIndex;
            return (
              <MarkerCard
                key={row.key}
                theme={theme}
                platform={platform}
                marker={marker}
                focused={focused}
                checked={props.selected.has(marker.finding.id)}
                knownFiles={props.knownFiles}
                onToggle={props.onToggle}
                onFocus={props.onFocus}
                onOpenReference={props.onOpenReference}
              />
            );
          }
          const isFirstTarget = row.key === firstTargetKey;
          return (
            <LineRow
              // Native onLayout fires only when layout changes, so remount the first target row per target
              // to get a fresh measurement when the user jumps to a row that is already on screen.
              key={isFirstTarget ? `${row.key}@${targetKey}` : row.key}
              theme={theme}
              platform={platform}
              line={row.line}
              highlight={row.target ? focusedSeverity : null}
              isTarget={row.target}
              stripe={row.stripe}
              gutterWidth={gutterWidth}
              onLayoutY={isFirstTarget ? onTargetLayout : undefined}
            />
          );
        })}
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {props.onBack ? (
          <Pressable accessibilityRole="button" style={styles.back} hitSlop={6} onPress={props.onBack}>
            <Icon name="ChevronLeft" size={14} color={theme.colors.foregroundMuted} />
            <Text style={styles.backText}>Findings</Text>
          </Pressable>
        ) : null}
        <View style={styles.row}>
          <Icon name="FileDiff" size={15} color={theme.colors.foreground} />
          <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
            {target.file}
          </Text>
          {diff ? <Text style={styles.badge}>{STATUS_LABEL[diff.status]}</Text> : null}
          {props.onClose ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Close diff" style={styles.iconButton} onPress={props.onClose}>
              <Icon name="X" size={15} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.row}>
          <Text style={styles.sub} numberOfLines={1}>
            {lineLabel}
            {nav && nav.count > 1 ? ` · location ${nav.index + 1} of ${nav.count}` : ""}
          </Text>
          {nav && nav.count > 1 ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous location" style={styles.iconButton} onPress={() => nav.onStep(-1)}>
                <Icon name="ChevronUp" size={15} color={theme.colors.foreground} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Next location" style={styles.iconButton} onPress={() => nav.onStep(1)}>
                <Icon name="ChevronDown" size={15} color={theme.colors.foreground} />
              </Pressable>
            </>
          ) : null}
          {diff?.status === "modified" && context < MORE_CONTEXT ? (
            <Pressable accessibilityRole="button" style={styles.tool} onPress={() => setContext(MORE_CONTEXT)}>
              <Text style={styles.toolText}>More context</Text>
            </Pressable>
          ) : null}
          {diff?.status === "modified" && context < WHOLE_FILE_CONTEXT ? (
            <Pressable accessibilityRole="button" style={styles.tool} onPress={() => setContext(WHOLE_FILE_CONTEXT)}>
              <Text style={styles.toolText}>Whole file</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {body}
    </View>
  );
}

interface LineRowProps {
  theme: PluginTheme;
  platform: Platform;
  line: DiffLine;
  isTarget: boolean;
  /** Severity of the focused finding; colors the target highlight. */
  highlight: Finding["severity"] | null;
  /** Gutter stripe for lines that belong to any finding. */
  stripe: string | null;
  gutterWidth: number;
  onLayoutY?: (y: number) => void;
}

const LineRow = memo(function LineRow({ theme, platform, line, isTarget, highlight, stripe, gutterWidth, onLayoutY }: LineRowProps) {
  const mono = monoFont(platform);
  const highlightColor = highlight ? severityColor(theme, highlight) : theme.colors.accent;
  const gutter = {
    width: gutterWidth,
    paddingRight: 6,
    textAlign: "right" as const,
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    lineHeight: 18,
    fontFamily: mono,
    opacity: 0.8,
  };
  return (
    <View
      style={{ flexDirection: "row", position: "relative", minHeight: 18 }}
      onLayout={onLayoutY ? (event) => onLayoutY(event.nativeEvent.layout.y) : undefined}
    >
      {line.kind === "add" ? <Tint color={theme.colors.statusSuccess} opacity={0.14} /> : null}
      {line.kind === "del" ? <Tint color={theme.colors.statusDanger} opacity={0.14} /> : null}
      {isTarget ? <Tint color={highlightColor} opacity={0.2} /> : null}
      <View style={{ width: 3, backgroundColor: isTarget ? highlightColor : (stripe ?? "transparent") }} />
      <Text style={gutter} selectable={false}>
        {line.oldLine ?? ""}
      </Text>
      <Text style={gutter} selectable={false}>
        {line.newLine ?? ""}
      </Text>
      <Text
        selectable={false}
        style={{ width: 14, color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontFamily: mono }}
      >
        {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
      </Text>
      <Text selectable style={{ flex: 1, paddingRight: 10, color: theme.colors.foreground, fontSize: 12, lineHeight: 18, fontFamily: mono }}>
        {line.text.replace(/\t/g, "    ") || " "}
      </Text>
    </View>
  );
});

interface MarkerCardProps {
  theme: PluginTheme;
  platform: Platform;
  marker: FileMarker;
  focused: boolean;
  checked: boolean;
  knownFiles: readonly string[];
  onToggle(id: string): void;
  onFocus(finding: Finding, locationIndex: number): void;
  onOpenReference(finding: Finding | null, reference: CodeReference): void;
}

const MarkerCard = memo(function MarkerCard({
  theme,
  platform,
  marker,
  focused,
  checked,
  knownFiles,
  onToggle,
  onFocus,
  onOpenReference,
}: MarkerCardProps) {
  const { finding, location, status } = marker;
  const color = severityColor(theme, finding.severity);
  const dismissed = status === "dismissed";
  const text = { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${finding.id}: ${finding.title}`}
      onPress={() => onFocus(finding, marker.locationIndex)}
      style={{
        position: "relative",
        overflow: "hidden",
        marginHorizontal: 10,
        marginVertical: 6,
        paddingVertical: 8,
        paddingLeft: 13,
        paddingRight: 10,
        gap: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: focused ? color : theme.colors.border,
        backgroundColor: theme.colors.surface1,
        opacity: isClosed(status) ? 0.65 : 1,
      }}
    >
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: color }} />
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <Checkbox
          theme={theme}
          checked={checked}
          disabled={dismissed}
          label={`Select ${finding.id} for fixing`}
          onPress={() => onToggle(finding.id)}
        />
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "700", fontFamily: monoFont(platform), marginTop: 2 }}>
          {finding.id}
        </Text>
        <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 13, lineHeight: 19, fontWeight: "600" }} numberOfLines={focused ? undefined : 1}>
          {finding.title}
        </Text>
        <StatusChip theme={theme} status={status} />
      </View>
      {focused ? (
        <View style={{ gap: 6, paddingLeft: 30 }}>
          {location.note ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              {endLineOf(location) > location.line ? "Lines" : "Line"} {formatLines(location)} · {location.note}
            </Text>
          ) : null}
          <LinkedText
            text={finding.detail}
            knownFiles={knownFiles}
            theme={theme}
            platform={platform}
            style={text}
            onPressReference={(reference) => onOpenReference(finding, reference)}
          />
          {finding.fix ? (
            <View style={{ gap: 2 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>Fix</Text>
              <LinkedText
                text={finding.fix}
                knownFiles={knownFiles}
                theme={theme}
                platform={platform}
                style={text}
                onPressReference={(reference) => onOpenReference(finding, reference)}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
});
