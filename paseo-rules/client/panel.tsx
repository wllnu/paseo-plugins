import { type PluginWorkspacePanelProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type Finding,
  type Review,
  type RuleResult,
  type RulesetResult,
  type Verdict,
  getReview,
  runReview,
  sendFeedback,
} from "../shared/contracts";

type Paseo = ReturnType<typeof usePaseo>;
type Agent = Awaited<ReturnType<Paseo["agents"]["list"]>>["entries"][number]["agent"];
type Theme = PluginWorkspacePanelProps["theme"];
type Styles = ReturnType<typeof makeStyles>;

const POLL_MS = 3000;
const LABELS: Record<Verdict, string> = {
  violated: "Broken",
  unsure: "Unsure",
  followed: "Followed",
  not_judged: "Not judged",
  not_applicable: "Does not apply",
};

function verdictColor(verdict: Verdict, theme: Theme) {
  if (verdict === "violated") return theme.colors.statusDanger;
  if (verdict === "unsure") return theme.colors.statusWarning;
  if (verdict === "followed") return theme.colors.statusSuccess;
  return theme.colors.foregroundMuted;
}

function needsAttention(verdict: Verdict) {
  return verdict === "violated" || verdict === "unsure";
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function countRules(result: Review, verdict: Verdict) {
  return result.rulesets.reduce(
    (sum, ruleset) => sum + ruleset.rules.filter((rule) => rule.verdict === verdict).length,
    0,
  );
}

function summary(result: Review) {
  const applied = result.rulesets.filter((ruleset) => ruleset.verdict !== "not_applicable").length;
  const broken = countRules(result, "violated");
  const unsure = countRules(result, "unsure");
  return [
    plural(result.files, "changed file"),
    `${applied} of ${plural(result.rulesets.length, "ruleset")} apply`,
    broken ? `${broken} broken` : "",
    unsure ? `${unsure} unsure` : "",
    result.skippedFiles ? `${plural(result.skippedFiles, "file")} not checked` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function location({ file, lines }: Finding) {
  const ranges = lines.map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`));
  return ranges.length ? `${file}:${ranges.join(", ")}` : file;
}

function makeStyles(theme: Theme, compact: boolean, platform: string) {
  const { colors } = theme;
  const mono = platform === "ios" ? "Menlo" : "monospace";
  const pad = compact ? 12 : 14;
  const row = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    minHeight: compact ? 44 : 32,
  };
  const button = {
    minHeight: compact ? 44 : 32,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    content: { padding: compact ? 16 : 24, gap: compact ? 12 : 16 },
    message: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
    error: { color: colors.statusDanger, fontSize: 13, lineHeight: 18 },
    card: {
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 10,
      overflow: "hidden" as const,
    },
    cardHeader: { padding: pad, gap: 6 },
    title: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
    meta: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    section: { borderTopColor: colors.border, borderTopWidth: 1, paddingHorizontal: pad },
    row,
    swatch: { width: 10, height: 10, borderRadius: 5 },
    rowLabel: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13 },
    rowValue: { fontSize: 12, fontWeight: "600" as const },
    rules: { paddingLeft: 18, paddingBottom: 8, gap: 8 },
    ruleId: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 12, fontFamily: mono },
    ruleText: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    finding: { ...row, gap: 8 },
    box: {
      width: 16,
      height: 16,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    findingText: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 12, fontFamily: mono },
    actions: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      alignItems: "center" as const,
      gap: 8,
      padding: pad,
      borderTopColor: colors.border,
      borderTopWidth: 1,
    },
    primary: { ...button, backgroundColor: colors.accent },
    primaryText: { color: colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
    secondary: { ...button, borderWidth: 1, borderColor: colors.border },
    secondaryText: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
    log: { paddingBottom: 10, gap: 2 },
    logLine: { color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, fontFamily: mono },
    settings: { alignSelf: "flex-start" as const },
    disabled: { opacity: 0.5 },
  };
}

function RuleRow({
  rule,
  isTicked,
  onToggle,
  theme,
  styles,
}: {
  rule: RuleResult;
  isTicked: (finding: Finding) => boolean;
  onToggle: (finding: Finding) => void;
  theme: Theme;
  styles: Styles;
}) {
  const color = verdictColor(rule.verdict, theme);
  return (
    <View>
      <View style={styles.row}>
        <View style={[styles.swatch, { backgroundColor: color }]} />
        <Text style={styles.ruleId} numberOfLines={1}>
          {rule.id}
        </Text>
        <Text style={[styles.rowValue, { color }]}>{LABELS[rule.verdict]}</Text>
      </View>
      <Text style={styles.ruleText}>{rule.rule}</Text>
      {rule.findings.map((finding) => {
        const ticked = isTicked(finding);
        return (
          <Pressable
            key={finding.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ticked }}
            accessibilityLabel={`Send ${rule.id} in ${location(finding)} to the agent`}
            onPress={() => onToggle(finding)}
            style={styles.finding}
          >
            <View style={[styles.box, ticked ? styles.boxOn : null]}>
              {ticked ? <Icon name="Check" size={12} color={theme.colors.accentForeground} /> : null}
            </View>
            <Text style={styles.findingText} numberOfLines={2}>
              {location(finding)}
            </Text>
            <Text style={[styles.rowValue, { color: verdictColor(finding.verdict, theme) }]}>
              {Math.round(finding.probability * 100)}%
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function RulesetRow({
  ruleset,
  isTicked,
  onToggle,
  theme,
  styles,
}: {
  ruleset: RulesetResult;
  isTicked: (finding: Finding) => boolean;
  onToggle: (finding: Finding) => void;
  theme: Theme;
  styles: Styles;
}) {
  // Rulesets with something to act on start open.
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? needsAttention(ruleset.verdict);
  const color = verdictColor(ruleset.verdict, theme);
  const count = ruleset.rules.filter((rule) => rule.verdict === ruleset.verdict).length;
  const value = needsAttention(ruleset.verdict)
    ? `${count} ${LABELS[ruleset.verdict].toLowerCase()}`
    : LABELS[ruleset.verdict];
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel={`${ruleset.title}, ${value}`}
        onPress={() => setOpen(!isOpen)}
        style={styles.row}
      >
        <View style={[styles.swatch, { backgroundColor: color }]} />
        <Text style={styles.rowLabel} numberOfLines={1}>
          {ruleset.title}
        </Text>
        <Text style={[styles.rowValue, { color }]}>{value}</Text>
        <Icon
          name={isOpen ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
      {isOpen ? (
        <View style={styles.rules}>
          <Text style={styles.meta}>{ruleset.file}</Text>
          {ruleset.rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              isTicked={isTicked}
              onToggle={onToggle}
              theme={theme}
              styles={styles}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function LogRow({ lines, theme, styles }: { lines: string[]; theme: Theme; styles: Styles }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Check log, ${plural(lines.length, "line")}`}
        onPress={() => setOpen(!open)}
        style={styles.row}
      >
        <Text style={[styles.rowLabel, { color: theme.colors.foregroundMuted }]}>Log</Text>
        <Text style={styles.meta}>{plural(lines.length, "line")}</Text>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
      {open ? (
        <View style={styles.log}>
          {lines.map((line, index) => (
            <Text key={index} style={styles.logLine} selectable>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AgentCard({ agent, theme, styles }: { agent: Agent; theme: Theme; styles: Styles }) {
  const fetchReview = useRpc(getReview);
  const startCheck = useRpc(runReview);
  const send = useRpc(sendFeedback);
  const toast = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["rules-review", agent.id];
  // lazy: polls while the panel is open, because a check starts on the daemon when a turn ends
  // and nothing pushes that to the client. Upgrade path: a server-to-client event in the SDK.
  const review = useQuery({
    queryKey,
    queryFn: () => fetchReview({ agentId: agent.id }),
    refetchInterval: POLL_MS,
  });
  // Violations start ticked and unsure findings start unticked. This holds only the user's changes.
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  const isTicked = (finding: Finding) => changed[finding.id] ?? finding.verdict === "violated";
  const onToggle = (finding: Finding) =>
    setChanged((current) => ({ ...current, [finding.id]: !isTicked(finding) }));

  const result = review.data?.review ?? null;
  const selected = (result?.rulesets ?? [])
    .flatMap((ruleset) => ruleset.rules.flatMap((rule) => rule.findings))
    .filter(isTicked)
    .map((finding) => finding.id);

  const check = useMutation({
    mutationFn: () => startCheck({ agentId: agent.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast.error(`Could not start the check. ${error.message}`),
  });
  const feedback = useMutation({
    mutationFn: () => send({ agentId: agent.id, findingIds: selected }),
    onSuccess: ({ sent }) =>
      toast.show(`Sent ${plural(sent, "broken rule")} to the agent.`, { variant: "success" }),
    onError: (error) => toast.error(`Could not send the findings. ${error.message}`),
  });

  const running = result?.status === "running" || check.isPending;
  const idle = agent.status === "idle";
  const canSend = selected.length > 0 && idle && !feedback.isPending;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.title} numberOfLines={1}>
          {agent.title ?? `Agent ${agent.id.slice(0, 8)}`}
        </Text>
        {review.error ? (
          <Text style={styles.error}>Could not load the check. {review.error.message}</Text>
        ) : review.isPending ? (
          <Text style={styles.meta}>Loading…</Text>
        ) : !result ? (
          <Text style={styles.meta}>No check yet. One runs when this agent finishes a turn.</Text>
        ) : (
          <>
            <Text style={styles.meta}>
              {running ? "Checking… " : ""}
              {result.rulesets.length > 0 ? summary(result) : ""}
            </Text>
            {result.message ? (
              <Text style={result.status === "error" ? styles.error : styles.meta}>{result.message}</Text>
            ) : null}
            {result.ruleErrors.map((error) => (
              <Text key={error} style={styles.error}>
                {error}
              </Text>
            ))}
          </>
        )}
      </View>
      {result?.rulesets.map((ruleset) => (
        <RulesetRow
          key={ruleset.id}
          ruleset={ruleset}
          isTicked={isTicked}
          onToggle={onToggle}
          theme={theme}
          styles={styles}
        />
      ))}
      {result?.log.length ? <LogRow lines={result.log} theme={theme} styles={styles} /> : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Check rules now"
          accessibilityState={{ disabled: running }}
          disabled={running}
          onPress={() => check.mutate()}
          style={[styles.secondary, running ? styles.disabled : null]}
        >
          <Text style={styles.secondaryText}>Check now</Text>
        </Pressable>
        {selected.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Send ${plural(selected.length, "finding")} to the agent`}
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => feedback.mutate()}
            style={[styles.primary, canSend ? null : styles.disabled]}
          >
            <Text style={styles.primaryText}>Send {selected.length} to agent</Text>
          </Pressable>
        ) : null}
        {selected.length > 0 && !idle ? (
          <Text style={styles.meta}>Wait for the agent to finish its turn.</Text>
        ) : null}
      </View>
    </View>
  );
}

export function RulesPanel({
  theme,
  layout,
  workspaceId,
  openSettings,
}: PluginWorkspacePanelProps & { openSettings: () => void }) {
  const paseo = usePaseo();
  const styles = useMemo(
    () => makeStyles(theme, layout.compact, layout.platform),
    [theme, layout.compact, layout.platform],
  );
  // lazy: polls the agent directory (capped at 200 agents) while this panel is open.
  // Upgrade path: agents.list({ subscribe: {} }) and apply agent_update messages.
  const agents = useQuery({
    queryKey: ["rules-agents"],
    queryFn: () =>
      paseo.agents.list({
        filter: { includeArchived: false },
        sort: [{ key: "created_at", direction: "desc" }],
        page: { limit: 200 },
      }),
    refetchInterval: POLL_MS,
  });
  const rows = (agents.data?.entries ?? [])
    .map((entry) => entry.agent)
    .filter((agent) => agent.workspaceId === workspaceId);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open judge settings"
        onPress={openSettings}
        style={[styles.secondary, styles.settings]}
      >
        <Text style={styles.secondaryText}>Judge settings</Text>
      </Pressable>
      {agents.error ? (
        <Text style={styles.error}>Could not load agents. {agents.error.message}</Text>
      ) : agents.isPending ? (
        <Text style={styles.message}>Loading agents…</Text>
      ) : rows.length === 0 ? (
        <Text style={styles.message}>No agents in this workspace yet.</Text>
      ) : null}
      {rows.map((agent) => (
        <AgentCard key={agent.id} agent={agent} theme={theme} styles={styles} />
      ))}
    </ScrollView>
  );
}
