import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { PlanComment } from "../shared/contracts";
import { describeLocator } from "../shared/feedback";

export interface CommentsModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  comments: readonly PlanComment[];
  theme: PluginTheme;
  onDelete(id: string): void;
  onClearSent(): void;
  onJumpTo(comment: PlanComment): void;
}

export function CommentsModal({ open, onOpenChange, comments, theme, onDelete, onClearSent, onJumpTo }: CommentsModalProps) {
  const styles = useMemo(
    () => ({
      empty: { color: theme.colors.foregroundMuted, fontSize: 14 },
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
        padding: 12,
        gap: 6,
      },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      where: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 16 },
      pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
      pillPending: { backgroundColor: theme.colors.accent },
      pillSent: { backgroundColor: theme.colors.surface2 },
      pillTextPending: { color: theme.colors.accentForeground, fontSize: 11, fontWeight: "600" as const },
      pillTextSent: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" as const },
      text: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
      quote: { color: theme.colors.foregroundMuted, fontSize: 12, fontStyle: "italic" as const },
      actions: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: 12, marginTop: 2 },
      action: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, paddingVertical: 4 },
      actionText: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      danger: { color: theme.colors.statusDanger, fontSize: 12, fontWeight: "600" as const },
      footer: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
      summary: { color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [theme],
  );

  const pending = comments.filter((comment) => comment.status === "pending").length;
  const sent = comments.length - pending;

  return (
    <Modal
      title={`Comments (${comments.length})`}
      icon={<Icon name="MessageSquareText" size={18} color={theme.colors.foreground} />}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Modal.Content>
        {comments.length === 0 ? (
          <Text style={styles.empty}>No comments yet. Select blocks in the rail on the right of the plan to add one.</Text>
        ) : null}
        {comments.map((comment) => {
          const isPending = comment.status === "pending";
          return (
            <View key={comment.id} style={styles.card}>
              <View style={styles.header}>
                <Text style={styles.where} numberOfLines={2}>
                  {describeLocator(comment.locator)}
                </Text>
                <View style={[styles.pill, isPending ? styles.pillPending : styles.pillSent]}>
                  <Text style={isPending ? styles.pillTextPending : styles.pillTextSent}>
                    {isPending ? "pending" : "sent"}
                  </Text>
                </View>
              </View>
              {comment.locator?.selectedText || comment.locator?.excerpt ? (
                <Text style={styles.quote} numberOfLines={3}>
                  “{comment.locator.selectedText ?? comment.locator.excerpt}”
                </Text>
              ) : null}
              <Text style={styles.text} selectable>
                {comment.text}
              </Text>
              <View style={styles.actions}>
                {comment.locator ? (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.action}
                    onPress={() => {
                      onJumpTo(comment);
                      onOpenChange(false);
                    }}
                  >
                    <Icon name="Locate" size={14} color={theme.colors.foregroundMuted} />
                    <Text style={styles.actionText}>Show in plan</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" style={styles.action} onPress={() => onDelete(comment.id)}>
                  <Icon name="Trash2" size={14} color={theme.colors.statusDanger} />
                  <Text style={styles.danger}>Delete</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
        {comments.length > 0 ? (
          <View style={styles.footer}>
            <Text style={styles.summary}>
              {pending} pending · {sent} sent
            </Text>
            {sent > 0 ? (
              <Pressable accessibilityRole="button" style={styles.action} onPress={onClearSent}>
                <Text style={styles.actionText}>Clear sent comments</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
