import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Finding } from "../shared/contracts";
import type { FindingStatus } from "../shared/findings";
import { monoFont, severityColor, type Platform } from "./ui";

export interface SendModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  theme: PluginTheme;
  platform: Platform;
  findings: readonly Finding[];
  statuses: ReadonlyMap<string, FindingStatus>;
  agentTitle: string;
  /** The agent is mid-turn: sending interrupts it. */
  agentBusy: boolean;
  busy: boolean;
  /** `comments` holds the per-finding comments, keyed by finding id. */
  onSend(note: string, comments: Record<string, string>): Promise<void>;
}

export function SendModal({
  open,
  onOpenChange,
  theme,
  platform,
  findings,
  statuses,
  agentTitle,
  agentBusy,
  busy,
  onSend,
}: SendModalProps) {
  const [note, setNote] = useState("");
  const [comments, setComments] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setNote("");
      setComments({});
    }
  }, [open]);

  const styles = useMemo(
    () => ({
      list: { gap: 10 },
      entry: { gap: 4 },
      item: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      dot: { width: 7, height: 7, borderRadius: 4 },
      id: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "700" as const, fontFamily: monoFont(platform), minWidth: 26 },
      title: { flex: 1, color: theme.colors.foreground, fontSize: 13 },
      notice: {
        flexDirection: "row" as const,
        gap: 8,
        padding: 10,
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.statusWarning,
        backgroundColor: theme.colors.surface2,
      },
      noticeText: { flex: 1, color: theme.colors.foreground, fontSize: 12, lineHeight: 17 },
      comment: {
        marginLeft: 15,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        color: theme.colors.foreground,
        fontSize: 13,
        lineHeight: 18,
        textAlignVertical: "top" as const,
      },
      input: {
        minHeight: 80,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        color: theme.colors.foreground,
        fontSize: 14,
        lineHeight: 20,
        textAlignVertical: "top" as const,
      },
      actions: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: 8 },
      secondary: {
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      secondaryText: { color: theme.colors.foreground, fontWeight: "600" as const },
      primary: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
      },
      primaryDisabled: { opacity: 0.5 },
      primaryText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
    }),
    [theme, platform],
  );

  const resent = findings.filter((finding) => statuses.get(finding.id) !== "open").map((finding) => finding.id);
  const canSend = findings.length > 0 && !busy;

  async function send() {
    if (!canSend) return;
    await onSend(note, comments);
  }

  return (
    <Modal
      title={findings.length === 1 ? "Send 1 finding for fixing" : `Send ${findings.length} findings for fixing`}
      icon={<Icon name="Send" size={18} color={theme.colors.foreground} />}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Modal.Content>
        <View style={styles.list}>
          {findings.map((finding) => (
            <View key={finding.id} style={styles.entry}>
              <View style={styles.item}>
                <View style={[styles.dot, { backgroundColor: severityColor(theme, finding.severity) }]} />
                <Text style={styles.id}>{finding.id}</Text>
                <Text style={styles.title} numberOfLines={1}>
                  {finding.title}
                </Text>
              </View>
              <TextInput
                value={comments[finding.id] ?? ""}
                onChangeText={(text) => setComments((current) => ({ ...current, [finding.id]: text }))}
                multiline
                placeholder="Optional comment, e.g. how to fix it instead"
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.comment}
                accessibilityLabel={`Comment on ${finding.id}`}
              />
            </View>
          ))}
        </View>
        {agentBusy ? (
          <View style={styles.notice}>
            <Icon name="TriangleAlert" size={15} color={theme.colors.statusWarning} />
            <Text style={styles.noticeText}>{agentTitle} is working right now. Sending interrupts its current turn.</Text>
          </View>
        ) : null}
        {resent.length > 0 ? (
          <View style={styles.notice}>
            <Icon name="CircleAlert" size={15} color={theme.colors.statusWarning} />
            <Text style={styles.noticeText}>
              {resent.join(", ")} {resent.length === 1 ? "was" : "were"} already sent or resolved and will be sent again.
            </Text>
          </View>
        ) : null}
        <TextInput
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="Optional note for the agent, e.g. “keep the public API unchanged”"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          accessibilityLabel="Note for the agent"
        />
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => onOpenChange(false)}>
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Send to ${agentTitle}`}
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            style={[styles.primary, canSend ? null : styles.primaryDisabled]}
            onPress={() => void send()}
          >
            <Icon name="Send" size={15} color={theme.colors.accentForeground} />
            <Text style={styles.primaryText}>{busy ? "Sending…" : `Send to ${agentTitle}`}</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
