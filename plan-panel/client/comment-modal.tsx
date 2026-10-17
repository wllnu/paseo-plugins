import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PlanLocator } from "../shared/contracts";
import { describeBlock, describeLocator, locatorBlocks } from "../shared/feedback";

/** Blocks listed in the composer before the rest collapse into a count. */
const MAX_LISTED_BLOCKS = 5;

export interface CommentModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  locator: PlanLocator | null;
  theme: PluginTheme;
  busy: boolean;
  onSubmit(text: string): Promise<void>;
}

export function CommentModal({ open, onOpenChange, locator, theme, busy, onSubmit }: CommentModalProps) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText("");
  }, [open, locator?.key]);

  const styles = useMemo(
    () => ({
      label: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const, textTransform: "uppercase" as const },
      where: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
      quoteBox: {
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.accent,
        paddingLeft: 10,
        paddingVertical: 2,
      },
      quote: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19, fontStyle: "italic" as const },
      blockWhere: { color: theme.colors.foreground, fontSize: 12, lineHeight: 17 },
      more: { color: theme.colors.foregroundMuted, fontSize: 12 },
      input: {
        minHeight: 110,
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
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      primaryDisabled: { opacity: 0.5 },
      primaryText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
    }),
    [theme],
  );

  const blocks = locator ? locatorBlocks(locator) : [];
  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    await onSubmit(trimmed);
    onOpenChange(false);
  }

  return (
    <Modal
      title={
        locator?.selectedText
          ? "Comment on the highlighted text"
          : blocks.length > 1
            ? `Comment on ${blocks.length} blocks`
            : locator
              ? "Comment on this part of the plan"
              : "Comment on the whole plan"
      }
      icon={<Icon name="MessageSquarePlus" size={18} color={theme.colors.foreground} />}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Modal.Content>
        {blocks.length > 1 ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.label}>Selected blocks</Text>
            {blocks.slice(0, MAX_LISTED_BLOCKS).map((block) => (
              <View key={block.key} style={[styles.quoteBox, { gap: 2 }]}>
                <Text style={styles.blockWhere} numberOfLines={1}>
                  {describeBlock(block)}
                </Text>
                {block.excerpt ? (
                  <Text style={styles.quote} numberOfLines={2}>
                    {block.excerpt}
                  </Text>
                ) : null}
              </View>
            ))}
            {blocks.length > MAX_LISTED_BLOCKS ? (
              <Text style={styles.more}>and {blocks.length - MAX_LISTED_BLOCKS} more</Text>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Where</Text>
            <Text style={styles.where}>{describeLocator(locator)}</Text>
          </View>
        )}
        {blocks.length > 1 ? null : locator?.selectedText ? (
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Selected text</Text>
            <View style={styles.quoteBox}>
              <Text style={styles.quote} numberOfLines={8}>
                {locator.selectedText}
              </Text>
            </View>
          </View>
        ) : locator?.excerpt ? (
          <View style={styles.quoteBox}>
            <Text style={styles.quote} numberOfLines={4}>
              {locator.excerpt}
            </Text>
          </View>
        ) : null}
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          placeholder="What should change here?"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          accessibilityLabel="Comment text"
        />
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => onOpenChange(false)}>
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
            disabled={!canSubmit}
            style={[styles.primary, canSubmit ? null : styles.primaryDisabled]}
            onPress={() => void submit()}
          >
            <Icon name="Plus" size={16} color={theme.colors.accentForeground} />
            <Text style={styles.primaryText}>{busy ? "Saving…" : "Add comment"}</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
