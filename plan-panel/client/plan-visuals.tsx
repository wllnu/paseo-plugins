import type { PluginTheme } from "@getpaseo/plugin";
import { Fragment, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { HtmlElement } from "../shared/html";

/*
 * Visual building blocks for plans. Agents opt in with a `class` on plain HTML elements
 * (`<ol class="steps">`, `<li class="warn">`), so a plan stays ordinary HTML everywhere else.
 */

export const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
});

/** Semantic tones for list items, callouts, chips, columns, and inline tags. */
export type Tone = "ok" | "no" | "warn" | "risk" | "ask" | "note";

const TONES: readonly Tone[] = ["ok", "no", "warn", "risk", "ask", "note"];

const TONE_GLYPHS: Record<Tone, string> = { ok: "✓", no: "✕", warn: "!", risk: "!", ask: "?", note: "i" };

/** Below this width per box, a flow stacks top to bottom instead of running left to right. */
const FLOW_MIN_BOX_WIDTH = 150;

export function classesOf(element: HtmlElement): Set<string> {
  return new Set((element.attrs.class ?? "").toLowerCase().split(/\s+/).filter(Boolean));
}

export function toneOf(classes: ReadonlySet<string>): Tone | null {
  return TONES.find((tone) => classes.has(tone)) ?? null;
}

export function toneColor(theme: PluginTheme, tone: Tone): string {
  switch (tone) {
    case "ok":
      return theme.colors.statusSuccess;
    case "warn":
      return theme.colors.statusWarning;
    case "risk":
      return theme.colors.statusDanger;
    case "ask":
      return theme.colors.accent;
    case "no":
    case "note":
      return theme.colors.foregroundMuted;
  }
}

/** `color` at the given opacity. Theme colors are hex or rgb(); any other format yields no tint. */
export function tint(color: string, alpha: number): string {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((digit) => digit + digit).join("") : hex[1]!;
    const n = Number.parseInt(digits, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  return "transparent";
}

export function createVisualStyles(theme: PluginTheme, compact: boolean, text: TextStyle) {
  const colors = theme.colors;
  const base = text.fontSize ?? 15;
  const lineHeight = text.lineHeight ?? Math.round(base * 1.55);
  const sized = (size: number, ratio: number): TextStyle => ({ fontSize: size, lineHeight: Math.round(size * ratio) });
  const kvKeyWidth = compact ? 104 : 128;
  return {
    document: { gap: compact ? 16 : 20 } as ViewStyle,
    header: {
      gap: compact ? 6 : 8,
      paddingBottom: compact ? 12 : 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    } as ViewStyle,
    blockChosen: { backgroundColor: tint(colors.accent, 0.1), borderLeftColor: colors.accent } as ViewStyle,
    chosenLabel: { color: colors.accent, fontSize: 11, fontWeight: "700" } as TextStyle,
    chosenMark: { color: colors.accent, fontWeight: "700" } as TextStyle,
    tag: { fontSize: base - 3, fontWeight: "700" } as TextStyle,

    markerBox: { width: 24, height: lineHeight, justifyContent: "center" } as ViewStyle,
    toneMarker: { width: 17, height: 17, borderRadius: 9, alignItems: "center", justifyContent: "center" } as ViewStyle,
    toneGlyph: { fontSize: 11, lineHeight: 15, fontWeight: "800", textAlign: "center", userSelect: "none" } as TextStyle,
    checkBox: {
      width: 15,
      height: 15,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: colors.foregroundMuted,
      alignItems: "center",
      justifyContent: "center",
    } as ViewStyle,
    checkBoxDone: { backgroundColor: colors.statusSuccess, borderColor: colors.statusSuccess } as ViewStyle,
    checkGlyph: { color: colors.surface0, fontSize: 10, lineHeight: 12, fontWeight: "800", userSelect: "none" } as TextStyle,
    fileSign: { ...text, fontFamily: MONO, width: 20, fontWeight: "700", userSelect: "none" } as TextStyle,
    fileText: { ...text, ...sized(base - 1, 1.6), fontFamily: MONO } as TextStyle,

    facts: { flexDirection: "row", flexWrap: "wrap", gap: 6 } as ViewStyle,
    chip: {
      marginLeft: 0,
      paddingVertical: 2,
      paddingLeft: 10,
      paddingRight: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderLeftWidth: 1,
      borderColor: colors.border,
      borderLeftColor: colors.border,
      backgroundColor: colors.surface1,
      alignItems: "center",
    } as ViewStyle,
    chipContent: { flexShrink: 1 } as ViewStyle,
    chipText: { ...text, ...sized(base - 2, 1.5), fontWeight: "600" } as TextStyle,
    chipLabel: { color: colors.foregroundMuted, fontWeight: "500" } as TextStyle,

    flowRow: { flexDirection: "row", alignItems: "stretch" } as ViewStyle,
    flowColumn: { alignItems: "stretch" } as ViewStyle,
    flowCell: { flex: 1, minWidth: 0 } as ViewStyle,
    flowArrow: {
      color: colors.foregroundMuted,
      fontSize: base + 1,
      alignSelf: "center",
      paddingHorizontal: 4,
      userSelect: "none",
    } as TextStyle,
    flowBox: {
      marginLeft: 0,
      flexGrow: 1,
      paddingVertical: 8,
      paddingLeft: 10,
      paddingRight: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderLeftWidth: 1,
      borderColor: colors.border,
      borderLeftColor: colors.border,
      backgroundColor: colors.surface1,
    } as ViewStyle,
    flowTitle: { ...text, ...sized(base - 1, 1.4), fontWeight: "600" } as TextStyle,
    flowCaption: { ...text, ...sized(base - 2, 1.45), color: colors.foregroundMuted } as TextStyle,

    stepRow: { flexDirection: "row", alignItems: "stretch" } as ViewStyle,
    stepRail: { width: 26, alignItems: "center" } as ViewStyle,
    stepDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      marginTop: Math.max(0, 4 + Math.round(lineHeight / 2) - 11),
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    } as ViewStyle,
    stepNumber: { fontSize: 11, lineHeight: 14, fontWeight: "700", color: colors.foreground, userSelect: "none" } as TextStyle,
    stepLine: { flex: 1, width: 2, marginVertical: 3, borderRadius: 1, backgroundColor: colors.border } as ViewStyle,
    stepLineDone: { backgroundColor: colors.statusSuccess } as ViewStyle,
    stepBody: { flex: 1, minWidth: 0, paddingLeft: 10, paddingBottom: compact ? 8 : 12, gap: 2 } as ViewStyle,
    stepTitle: { ...text, fontWeight: "600" } as TextStyle,
    stepCaption: { ...text, ...sized(base - 1, 1.5), color: colors.foregroundMuted } as TextStyle,

    kv: { gap: 2 } as ViewStyle,
    kvRow: { flexDirection: "row", gap: 12 } as ViewStyle,
    kvKey: { ...text, width: kvKeyWidth, fontWeight: "600", color: colors.foregroundMuted } as TextStyle,
    kvValue: { flex: 1, minWidth: 0 } as ViewStyle,
    kvNested: { marginLeft: kvKeyWidth + 12 } as ViewStyle,

    compare: { flexDirection: "row", flexWrap: "wrap", gap: 8 } as ViewStyle,
    column: {
      flexGrow: 1,
      flexBasis: 200,
      minWidth: 0,
      gap: 4,
      paddingVertical: 8,
      paddingLeft: 16,
      // The column's own comment rail runs along its right edge.
      paddingRight: 0,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
    } as ViewStyle,
    columnChosen: { borderColor: colors.accent, backgroundColor: tint(colors.accent, 0.07) } as ViewStyle,

    callout: {
      flexDirection: "row",
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderLeftWidth: 3,
    } as ViewStyle,
    calloutMarker: { height: lineHeight + 8, justifyContent: "center" } as ViewStyle,
    calloutBody: { flex: 1, minWidth: 0, paddingLeft: 8, gap: 2 } as ViewStyle,

    details: { gap: 2 } as ViewStyle,
    detailsToggle: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 6,
      paddingVertical: 2,
      paddingRight: 8,
      borderRadius: 6,
    } as ViewStyle,
    detailsTogglePressed: { backgroundColor: colors.surface1 } as ViewStyle,
    detailsChevron: {
      width: 12,
      color: colors.foregroundMuted,
      fontSize: base + 1,
      lineHeight: base + 3,
      fontWeight: "700",
      textAlign: "center",
      userSelect: "none",
    } as TextStyle,
    detailsChevronOpen: { transform: [{ rotate: "90deg" }] } as TextStyle,
    detailsLabel: { color: colors.foregroundMuted, fontSize: base - 2, fontWeight: "500", userSelect: "none" } as TextStyle,
    detailsBadge: {
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 5,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
    } as ViewStyle,
    detailsBadgeText: { color: colors.accentForeground, fontSize: 10, fontWeight: "700" } as TextStyle,
    detailsBody: { marginLeft: 5, paddingLeft: 13, borderLeftWidth: 2, borderLeftColor: colors.border, gap: 4 } as ViewStyle,
  };
}

export type VisualStyles = ReturnType<typeof createVisualStyles>;

export function ToneMarker({ tone, theme, styles }: { tone: Tone; theme: PluginTheme; styles: VisualStyles }) {
  const color = toneColor(theme, tone);
  // A solid marker for `risk`, so it reads as more severe than `warn` at a glance.
  const solid = tone === "risk";
  return (
    <View style={[styles.toneMarker, { backgroundColor: solid ? color : tint(color, 0.16) }]}>
      <Text style={[styles.toneGlyph, { color: solid ? theme.colors.surface0 : color }]} selectable={false}>
        {TONE_GLYPHS[tone]}
      </Text>
    </View>
  );
}

export function CheckBox({ done, styles }: { done: boolean; styles: VisualStyles }) {
  return (
    <View style={[styles.checkBox, done ? styles.checkBoxDone : null]}>
      {done ? (
        <Text style={styles.checkGlyph} selectable={false}>
          ✓
        </Text>
      ) : null}
    </View>
  );
}

/** Boxes left to right with arrows when they all fit on one row, otherwise stacked top to bottom. */
export function FlowLayout({ items, styles }: { items: readonly ReactNode[]; styles: VisualStyles }) {
  const [width, setWidth] = useState(0);
  const horizontal = width > 0 && width >= items.length * FLOW_MIN_BOX_WIDTH;
  return (
    <View
      style={horizontal ? styles.flowRow : styles.flowColumn}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <Text style={styles.flowArrow} selectable={false}>
              {horizontal ? "→" : "↓"}
            </Text>
          ) : null}
          <View style={horizontal ? styles.flowCell : null}>{item}</View>
        </Fragment>
      ))}
    </View>
  );
}

export interface CollapsibleProps {
  open: boolean;
  onToggle(): void;
  label: ReactNode;
  /** Comments on blocks inside, shown on the toggle while collapsed. */
  hiddenComments: number;
  styles: VisualStyles;
  children: ReactNode;
}

export function Collapsible({ open, onToggle, label, hiddenComments, styles, children }: CollapsibleProps) {
  return (
    <View style={styles.details}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.detailsToggle, pressed ? styles.detailsTogglePressed : null]}
      >
        <Text style={[styles.detailsChevron, open ? styles.detailsChevronOpen : null]} selectable={false}>
          ›
        </Text>
        <Text style={styles.detailsLabel} selectable={false}>
          {label}
        </Text>
        {hiddenComments > 0 ? (
          <View style={styles.detailsBadge}>
            <Text style={styles.detailsBadgeText}>{hiddenComments}</Text>
          </View>
        ) : null}
      </Pressable>
      {open ? <View style={styles.detailsBody}>{children}</View> : null}
    </View>
  );
}
