import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { memo, useMemo } from "react";
import { Pressable, Text, View, type StyleProp, type TextStyle } from "react-native";
import type { Severity } from "../shared/contracts";
import type { FindingStatus } from "../shared/findings";
import { splitReferences } from "../shared/references";

export type Platform = PluginHostProps["layout"]["platform"];

export function severityColor(theme: PluginTheme, severity: Severity): string {
  if (severity === "blocking") return theme.colors.statusDanger;
  if (severity === "should-fix") return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

export function monoFont(platform: Platform): string {
  if (platform === "ios") return "Menlo";
  if (platform === "android") return "monospace";
  return "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
}

/**
 * A translucent wash of `color` behind a row. Theme colors may be hex, rgb, or named, so the tint is an
 * absolutely positioned layer with opacity rather than a computed rgba string.
 */
export function Tint({ color, opacity }: { color: string; opacity: number }) {
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: color,
        opacity,
        pointerEvents: "none",
      }}
    />
  );
}

export function Checkbox({
  theme,
  checked,
  disabled,
  label,
  onPress,
}: {
  theme: PluginTheme;
  checked: boolean;
  disabled?: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={{ padding: 2, opacity: disabled ? 0.35 : 1 }}
    >
      <Icon
        name={checked ? "SquareCheck" : "Square"}
        size={18}
        color={checked ? theme.colors.accent : theme.colors.foregroundMuted}
      />
    </Pressable>
  );
}

const STATUS_LABEL: Record<Exclude<FindingStatus, "open">, string> = {
  sent: "Sent",
  fixed: "Fixed",
  "wont-fix": "Won't fix",
  dismissed: "Dismissed",
};

export function StatusChip({ theme, status }: { theme: PluginTheme; status: FindingStatus }) {
  if (status === "open") return null;
  const dot =
    status === "fixed"
      ? theme.colors.statusSuccess
      : status === "sent"
        ? theme.colors.accent
        : theme.colors.foregroundMuted;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: theme.colors.surface2,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

export interface CodeReference {
  file: string;
  line: number;
  endLine: number | null;
}

interface LinkedTextProps {
  text: string;
  knownFiles: readonly string[];
  theme: PluginTheme;
  platform: Platform;
  style: StyleProp<TextStyle>;
  numberOfLines?: number;
  onPressReference(reference: CodeReference): void;
}

/** Finding prose with `code` spans in monospace and `path:line` references as links into the diff. */
export const LinkedText = memo(function LinkedText({
  text,
  knownFiles,
  theme,
  platform,
  style,
  numberOfLines,
  onPressReference,
}: LinkedTextProps) {
  const segments = useMemo(
    () =>
      text.split(/(`[^`\n]+`)/).map((segment) => {
        const code = segment.length > 2 && segment.startsWith("`") && segment.endsWith("`");
        const body = code ? segment.slice(1, -1) : segment;
        return { code, parts: splitReferences(body, knownFiles) };
      }),
    [text, knownFiles],
  );
  const codeStyle = { fontFamily: monoFont(platform), fontSize: 12.5, color: theme.colors.foreground };
  const linkStyle = { color: theme.colors.accent, textDecorationLine: "underline" as const };
  return (
    <Text style={style} numberOfLines={numberOfLines} selectable>
      {segments.map((segment, segmentIndex) => (
        <Text key={segmentIndex} style={segment.code ? codeStyle : undefined}>
          {segment.parts.map((part, partIndex) =>
            part.kind === "text" ? (
              part.text
            ) : (
              <Text
                key={partIndex}
                accessibilityRole="link"
                style={linkStyle}
                onPress={() => onPressReference({ file: part.file, line: part.line, endLine: part.endLine })}
              >
                {part.text}
              </Text>
            ),
          )}
        </Text>
      ))}
    </Text>
  );
});
