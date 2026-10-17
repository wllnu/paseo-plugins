import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { memo, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SEVERITIES, type Finding, type Review, type Severity, type Verdict } from "../shared/contracts";
import {
  SEVERITY_META,
  countSeverities,
  describeCounts,
  describeScope,
  formatLines,
  formatLocation,
  isClosed,
  shortPath,
  type FindingStatus,
} from "../shared/findings";
import { Checkbox, LinkedText, StatusChip, monoFont, severityColor, type CodeReference, type Platform } from "./ui";

const VERDICT_LABEL: Record<Verdict, string> = {
  approve: "Approve",
  "changes-requested": "Changes requested",
  comment: "Comments only",
};

export interface FindingsListProps {
  theme: PluginTheme;
  compact: boolean;
  platform: Platform;
  review: Review;
  problems: readonly string[];
  /** Already sorted by severity and id. */
  findings: readonly Finding[];
  statuses: ReadonlyMap<string, FindingStatus>;
  selected: ReadonlySet<string>;
  /** Finding whose location is open in the diff view, highlighted in the list. */
  activeFindingId: string | null;
  knownFiles: readonly string[];
  onToggle(id: string): void;
  onToggleGroup(severity: Severity): void;
  onSetDismissed(id: string, dismissed: boolean): void;
  onOpenLocation(finding: Finding, index: number): void;
  onOpenReference(finding: Finding | null, reference: CodeReference): void;
}

function useListStyles(theme: PluginTheme, compact: boolean, platform: Platform) {
  return useMemo(() => {
    const pad = compact ? 12 : 16;
    return {
      scroll: { flex: 1 },
      content: { padding: pad, gap: 14, paddingBottom: 32 },
      summary: {
        gap: 8,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      summaryRow: { flexDirection: "row" as const, alignItems: "center" as const, flexWrap: "wrap" as const, gap: 8 },
      verdict: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: theme.colors.surface2,
      },
      verdictText: { color: theme.colors.foreground, fontSize: 12, fontWeight: "700" as const },
      counts: { color: theme.colors.foregroundMuted, fontSize: 12 },
      scopeRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      scope: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: monoFont(platform) },
      summaryText: { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 },
      problems: {
        gap: 4,
        padding: 10,
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.statusWarning,
        backgroundColor: theme.colors.surface2,
      },
      problemsTitle: { color: theme.colors.foreground, fontSize: 12, fontWeight: "700" as const },
      problem: { color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: monoFont(platform) },
      section: { gap: 8 },
      sectionHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      sectionDot: { width: 9, height: 9, borderRadius: 5 },
      sectionTitle: { color: theme.colors.foreground, fontSize: 13, fontWeight: "700" as const },
      sectionCount: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 },
      sectionAction: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
    };
  }, [theme, compact, platform]);
}

export function FindingsList(props: FindingsListProps) {
  const { theme, compact, platform, review, problems, findings, statuses, selected, knownFiles } = props;
  const styles = useListStyles(theme, compact, platform);
  const counts = useMemo(() => countSeverities(findings), [findings]);
  const verdictDot =
    review.verdict === "approve"
      ? theme.colors.statusSuccess
      : review.verdict === "changes-requested"
        ? theme.colors.statusDanger
        : theme.colors.foregroundMuted;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          {review.verdict ? (
            <View style={styles.verdict}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: verdictDot }} />
              <Text style={styles.verdictText}>{VERDICT_LABEL[review.verdict]}</Text>
            </View>
          ) : null}
          <Text style={styles.counts}>{describeCounts(counts)}</Text>
        </View>
        <View style={styles.scopeRow}>
          <Icon name="GitCompareArrows" size={13} color={theme.colors.foregroundMuted} />
          <Text style={styles.scope} numberOfLines={1}>
            {describeScope(review.scope)}
          </Text>
        </View>
        {review.summary ? (
          <LinkedText
            text={review.summary}
            knownFiles={knownFiles}
            theme={theme}
            platform={platform}
            style={styles.summaryText}
            onPressReference={(reference) => props.onOpenReference(null, reference)}
          />
        ) : null}
      </View>

      {problems.length > 0 ? (
        <View style={styles.problems}>
          <Text style={styles.problemsTitle}>
            {problems.length === 1 ? "1 problem in the review file" : `${problems.length} problems in the review file`}
          </Text>
          {problems.slice(0, 6).map((problem, index) => (
            <Text key={index} style={styles.problem}>
              {problem}
            </Text>
          ))}
          {problems.length > 6 ? <Text style={styles.problem}>…and {problems.length - 6} more</Text> : null}
        </View>
      ) : null}

      {findings.length === 0 ? (
        <Text style={styles.empty}>The reviewer found nothing to report.</Text>
      ) : null}

      {SEVERITIES.map((severity) => {
        const group = findings.filter((finding) => finding.severity === severity);
        if (group.length === 0) return null;
        const open = group.filter((finding) => !isClosed(statuses.get(finding.id) ?? "open"));
        const allSelected = open.length > 0 && open.every((finding) => selected.has(finding.id));
        return (
          <View key={severity} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionDot, { backgroundColor: severityColor(theme, severity) }]} />
              <Text style={styles.sectionTitle}>{SEVERITY_META[severity].heading}</Text>
              <Text style={styles.sectionCount}>
                {open.length === group.length ? group.length : `${open.length} open of ${group.length}`}
              </Text>
              {open.length > 0 ? (
                <Pressable accessibilityRole="button" hitSlop={6} onPress={() => props.onToggleGroup(severity)}>
                  <Text style={styles.sectionAction}>{allSelected ? "Clear" : "Select all"}</Text>
                </Pressable>
              ) : null}
            </View>
            {group.map((finding) => (
              <FindingCard
                key={finding.id}
                theme={theme}
                platform={platform}
                finding={finding}
                status={statuses.get(finding.id) ?? "open"}
                checked={selected.has(finding.id)}
                active={props.activeFindingId === finding.id}
                knownFiles={knownFiles}
                onToggle={props.onToggle}
                onSetDismissed={props.onSetDismissed}
                onOpenLocation={props.onOpenLocation}
                onOpenReference={props.onOpenReference}
              />
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

interface FindingCardProps {
  theme: PluginTheme;
  platform: Platform;
  finding: Finding;
  status: FindingStatus;
  checked: boolean;
  active: boolean;
  knownFiles: readonly string[];
  onToggle(id: string): void;
  onSetDismissed(id: string, dismissed: boolean): void;
  onOpenLocation(finding: Finding, index: number): void;
  onOpenReference(finding: Finding | null, reference: CodeReference): void;
}

const FindingCard = memo(function FindingCard({
  theme,
  platform,
  finding,
  status,
  checked,
  active,
  knownFiles,
  onToggle,
  onSetDismissed,
  onOpenLocation,
  onOpenReference,
}: FindingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const closed = isClosed(status);
  const dismissed = status === "dismissed";
  const color = severityColor(theme, finding.severity);
  const long =
    finding.detail.length > 220 || finding.detail.includes("\n") || (finding.fix?.length ?? 0) > 110 || Boolean(finding.fix?.includes("\n"));
  const styles = useMemo(
    () => ({
      card: {
        position: "relative" as const,
        overflow: "hidden" as const,
        gap: 7,
        paddingVertical: 10,
        paddingRight: 12,
        paddingLeft: 15,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      cardActive: { borderColor: theme.colors.accent },
      stripe: { position: "absolute" as const, left: 0, top: 0, bottom: 0, width: 4, backgroundColor: color },
      header: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
      id: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "700" as const, fontFamily: monoFont(platform), marginTop: 2 },
      title: {
        flex: 1,
        color: theme.colors.foreground,
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "600" as const,
        textDecorationLine: dismissed ? ("line-through" as const) : ("none" as const),
      },
      chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, paddingLeft: 30 },
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        maxWidth: "100%" as const,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      chipPressed: { backgroundColor: theme.colors.surface2 },
      // The path stays whole; the note gives way first.
      chipText: { color: theme.colors.foreground, fontSize: 12, fontFamily: monoFont(platform), flexShrink: 0, maxWidth: "100%" as const },
      chipNote: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
      body: { gap: 6, paddingLeft: 30 },
      symptom: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19, fontStyle: "italic" as const },
      detail: { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 },
      label: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700" as const, textTransform: "uppercase" as const },
      resolution: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      actions: { flexDirection: "row" as const, gap: 14, paddingLeft: 30 },
      action: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, paddingVertical: 2 },
      actionText: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
    }),
    [theme, platform, color, dismissed],
  );
  const openReference = (reference: CodeReference) => onOpenReference(finding, reference);

  return (
    <View style={[styles.card, active ? styles.cardActive : null, closed ? { opacity: 0.6 } : null]}>
      <View style={styles.stripe} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${checked ? "Deselect" : "Select"} ${finding.id}`}
        disabled={dismissed}
        style={styles.header}
        onPress={() => onToggle(finding.id)}
      >
        <Checkbox
          theme={theme}
          checked={checked}
          disabled={dismissed}
          label={`Select ${finding.id} for fixing`}
          onPress={() => onToggle(finding.id)}
        />
        <Text style={styles.id}>{finding.id}</Text>
        <Text style={styles.title}>{finding.title}</Text>
        <StatusChip theme={theme} status={status} />
      </Pressable>

      {finding.locations.length > 0 ? (
        <View style={styles.chips}>
          {finding.locations.map((location, index) => (
            <Pressable
              key={`${location.file}:${location.line}:${index}`}
              accessibilityRole="link"
              accessibilityLabel={`Open diff at ${formatLocation(location)}`}
              style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null]}
              onPress={() => onOpenLocation(finding, index)}
            >
              <Icon name="FileDiff" size={12} color={color} />
              <Text style={styles.chipText} numberOfLines={1}>
                {shortPath(location.file)}:{formatLines(location)}
              </Text>
              {location.side === "old" || location.note ? (
                <Text style={styles.chipNote} numberOfLines={1}>
                  {[location.side === "old" ? "removed" : null, location.note].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.body}>
        {finding.symptom ? (
          <LinkedText
            text={finding.symptom}
            knownFiles={knownFiles}
            theme={theme}
            platform={platform}
            style={styles.symptom}
            numberOfLines={expanded ? undefined : 2}
            onPressReference={openReference}
          />
        ) : null}
        <LinkedText
          text={finding.detail}
          knownFiles={knownFiles}
          theme={theme}
          platform={platform}
          style={styles.detail}
          numberOfLines={expanded ? undefined : 4}
          onPressReference={openReference}
        />
        {finding.fix ? (
          <View style={{ gap: 2 }}>
            <Text style={styles.label}>Fix</Text>
            <LinkedText
              text={finding.fix}
              knownFiles={knownFiles}
              theme={theme}
              platform={platform}
              style={styles.detail}
              numberOfLines={expanded ? undefined : 2}
              onPressReference={openReference}
            />
          </View>
        ) : null}
        {finding.resolution?.note ? (
          <Text style={styles.resolution}>
            {finding.resolution.status === "fixed" ? "Fixed: " : "Won't fix: "}
            {finding.resolution.note}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {long || finding.symptom ? (
          <Pressable accessibilityRole="button" style={styles.action} onPress={() => setExpanded((value) => !value)}>
            <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={13} color={theme.colors.foregroundMuted} />
            <Text style={styles.actionText}>{expanded ? "Less" : "More"}</Text>
          </Pressable>
        ) : null}
        {status === "fixed" || status === "wont-fix" ? null : (
          <Pressable
            accessibilityRole="button"
            style={styles.action}
            onPress={() => onSetDismissed(finding.id, !dismissed)}
          >
            <Icon name={dismissed ? "Undo2" : "EyeOff"} size={13} color={theme.colors.foregroundMuted} />
            <Text style={styles.actionText}>{dismissed ? "Restore" : "Dismiss"}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
});
