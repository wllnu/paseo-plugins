import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { PlanLocatorBase } from "../shared/contracts";
import { describeBlock } from "../shared/feedback";
import { findElements, type HtmlElement, type HtmlNode } from "../shared/html";
import {
  CheckBox,
  classesOf,
  Collapsible,
  createVisualStyles,
  FlowLayout,
  MONO,
  tint,
  ToneMarker,
  toneColor,
  toneOf,
  type Tone,
} from "./plan-visuals";
import { blockElementId, clearPlanSelection } from "./web";

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "img",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
  "ul",
]);

const SKIPPED_TAGS = new Set(["head", "title", "meta", "link", "base", "template", "button", "input", "select"]);

/** Children of a `compare` row that are columns of blocks rather than a single block. */
const COLUMN_CONTAINERS = new Set(["div", "section", "article", "main", "figure", "header", "footer", "nav"]);

const HEADING_LEVEL: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

/** Leading change markers in a `files` list. */
const CHANGE_SIGNS: Record<string, "+" | "~" | "−"> = { "+": "+", "~": "~", "-": "−", "−": "−" };

/** Width of the comment rail on the right of every selectable block. */
const RAIL_WIDTH = 24;

/** Widens the rail's touch target into the panel padding on its right. */
const RAIL_HIT_SLOP = { left: 4, right: 8 };

export interface PlanViewProps {
  body: HtmlElement;
  revision: string | null;
  theme: PluginTheme;
  compact: boolean;
  /** Number of comments per locator key. */
  commentCounts: Readonly<Record<string, number>>;
  /** Locator keys of the blocks selected in the comment rail. */
  selectedKeys: ReadonlySet<string>;
  onSelectionChange(keys: ReadonlySet<string>): void;
  /** Filled with every rendered block's locator, keyed by locator key. Cleared on each render. */
  registry: Map<string, PlanLocatorBase>;
}

type Styles = ReturnType<typeof createStyles>;

interface RenderContext {
  theme: PluginTheme;
  styles: Styles;
  revision: string | null;
  commentCounts: Readonly<Record<string, number>>;
  selectedKeys: ReadonlySet<string>;
  /** A rail handle was pressed; `extend` selects the range from the last pressed handle. */
  onToggleUnit(key: string, extend: boolean): void;
  registry: Map<string, PlanLocatorBase>;
  /** Whether a `details` block is expanded: the user's choice, else the fallback. */
  isOpen(key: string, fallback: boolean): boolean;
  setOpen(key: string, open: boolean): void;
}

/** Mutable document-order state used to compute locators. */
interface Walk {
  headings: { level: number; text: string }[];
  anchorId: string | null;
  counters: Map<string, number>;
  keySeq: number;
  /** Every block's locator key in document order, for rolling comment counts up to containers. */
  blockKeys: string[];
  /** Keys of the blocks with a rail handle that are visible, in document order: the range for shift-click. */
  units: string[];
  /** Above zero inside a component selected as a whole; blocks there get no rail handle of their own. */
  groupDepth: number;
}

type ItemMarker =
  | { kind: "text"; text: string }
  | { kind: "tone"; tone: Tone }
  | { kind: "check"; done: boolean }
  | { kind: "file" };

function createStyles(theme: PluginTheme, compact: boolean) {
  const base = compact ? 14 : 15;
  const text: TextStyle = {
    color: theme.colors.foreground,
    fontSize: base,
    lineHeight: Math.round(base * 1.55),
    userSelect: "text",
  };
  return {
    ...createVisualStyles(theme, compact, text),
    text,
    muted: { color: theme.colors.foregroundMuted } as TextStyle,
    h1: { ...text, fontSize: base + 9, lineHeight: Math.round((base + 9) * 1.3), fontWeight: "700" } as TextStyle,
    h2: { ...text, fontSize: base + 5, lineHeight: Math.round((base + 5) * 1.35), fontWeight: "700" } as TextStyle,
    h3: { ...text, fontSize: base + 2, lineHeight: Math.round((base + 2) * 1.4), fontWeight: "600" } as TextStyle,
    h4: { ...text, fontWeight: "600" } as TextStyle,
    strong: { fontWeight: "700" } as TextStyle,
    em: { fontStyle: "italic" } as TextStyle,
    del: { textDecorationLine: "line-through" } as TextStyle,
    mark: { backgroundColor: theme.colors.statusWarning, color: theme.colors.foreground } as TextStyle,
    small: { fontSize: base - 2, color: theme.colors.foregroundMuted } as TextStyle,
    link: { color: theme.colors.accent, textDecorationLine: "underline" } as TextStyle,
    code: {
      fontFamily: MONO,
      fontSize: base - 1,
      backgroundColor: theme.colors.surface2,
      color: theme.colors.foreground,
    } as TextStyle,
    pre: {
      fontFamily: MONO,
      fontSize: base - 1,
      lineHeight: Math.round((base - 1) * 1.5),
      color: theme.colors.foreground,
    } as TextStyle,
    preBox: {
      backgroundColor: theme.colors.surface1,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 6,
      padding: compact ? 10 : 12,
    } as ViewStyle,
    block: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: 4,
      paddingLeft: 8,
      paddingRight: 6,
      marginLeft: -8,
      borderRadius: 6,
      borderLeftWidth: 3,
      borderLeftColor: "transparent",
    } as ViewStyle,
    blockHovered: { backgroundColor: theme.colors.surface1 } as ViewStyle,
    blockSelected: { backgroundColor: tint(theme.colors.accent, 0.12), borderLeftColor: theme.colors.accent } as ViewStyle,
    blockContent: { flex: 1, minWidth: 0 } as ViewStyle,
    badges: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 8, paddingTop: 2 } as ViewStyle,
    unit: { flexDirection: "row", alignItems: "stretch" } as ViewStyle,
    unitBody: { flex: 1, minWidth: 0 } as ViewStyle,
    rail: { width: RAIL_WIDTH, alignItems: "center", paddingVertical: 3, gap: 3, cursor: "pointer" } as ViewStyle,
    railBar: { flex: 1, width: 3, minHeight: 8, borderRadius: 2, backgroundColor: theme.colors.border } as ViewStyle,
    railBarHint: { backgroundColor: tint(theme.colors.foregroundMuted, 0.55) } as ViewStyle,
    railBarHovered: { width: 5, borderRadius: 3, backgroundColor: theme.colors.foregroundMuted } as ViewStyle,
    railBarSelected: { width: 5, borderRadius: 3, backgroundColor: theme.colors.accent } as ViewStyle,
    badge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
    } as ViewStyle,
    badgeText: { color: theme.colors.accentForeground, fontSize: 11, fontWeight: "700" } as TextStyle,
    revised: { color: theme.colors.statusSuccess, fontSize: 11, fontWeight: "600" } as TextStyle,
    section: { gap: compact ? 6 : 8 } as ViewStyle,
    list: { gap: 2 } as ViewStyle,
    listItem: { flexDirection: "row", alignItems: "flex-start" } as ViewStyle,
    marker: { ...text, width: 24, color: theme.colors.foregroundMuted, userSelect: "none" } as TextStyle,
    nested: { marginLeft: 24, marginTop: 2 } as ViewStyle,
    quote: {
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.border,
      paddingLeft: 12,
      marginLeft: 2,
      gap: 4,
    } as ViewStyle,
    hr: { height: 1, backgroundColor: theme.colors.border, marginVertical: 8 } as ViewStyle,
    // Rows carry the table's frame themselves, so each row's rail handle sits outside the table.
    rowBlock: { paddingVertical: 0, paddingLeft: 0, paddingRight: 0, marginLeft: 0, borderLeftWidth: 0, borderRadius: 0 } as ViewStyle,
    row: {
      flexDirection: "row",
      overflow: "hidden",
      borderColor: theme.colors.border,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
    } as ViewStyle,
    rowTop: { borderTopLeftRadius: 6, borderTopRightRadius: 6 } as ViewStyle,
    rowBottom: { borderBottomLeftRadius: 6, borderBottomRightRadius: 6 } as ViewStyle,
    lastRow: { borderBottomWidth: 1 } as ViewStyle,
    cell: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, minWidth: 0 } as ViewStyle,
    headerCell: { backgroundColor: theme.colors.surface1 } as ViewStyle,
    th: { ...text, fontWeight: "600", fontSize: base - 1 } as TextStyle,
    td: { ...text, fontSize: base - 1 } as TextStyle,
    summary: { ...text, fontWeight: "600" } as TextStyle,
    image: { ...text, color: theme.colors.foregroundMuted, fontStyle: "italic" } as TextStyle,
  };
}

function isBlock(node: HtmlNode): node is HtmlElement {
  return node.type === "element" && BLOCK_TAGS.has(node.tag);
}

function isElement(node: HtmlNode, tag?: string): node is HtmlElement {
  return node.type === "element" && (tag === undefined || node.tag === tag);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ");
}

function inlineText(nodes: readonly HtmlNode[]): string {
  const parts: string[] = [];
  const visit = (node: HtmlNode) => {
    if (node.type === "text") {
      parts.push(node.text);
      return;
    }
    if (node.tag === "br") parts.push(" ");
    if (node.tag === "img") parts.push(node.attrs.alt ?? "");
    for (const child of node.children) visit(child);
  };
  nodes.forEach(visit);
  return collapse(parts.join("")).trim();
}

/** Text of mixed content with a space between blocks, for the excerpt of a whole component. */
function flatText(nodes: readonly HtmlNode[]): string {
  return collapse(nodes.map((node) => inlineText([node])).join(" ")).trim();
}

function excerptOf(text: string): string {
  const normalized = collapse(text).trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157).trimEnd()}…` : normalized;
}

function rawText(nodes: readonly HtmlNode[]): string {
  const parts: string[] = [];
  const visit = (node: HtmlNode) => {
    if (node.type === "text") {
      parts.push(node.text);
      return;
    }
    if (node.tag === "br") parts.push("\n");
    for (const child of node.children) visit(child);
  };
  nodes.forEach(visit);
  return parts.join("").replace(/^\n/, "").replace(/\n$/, "");
}

function revisedOf(element: HtmlElement | null | undefined): string | null {
  return element?.attrs["data-revised"] ?? null;
}

/** An item's own text and its nested blocks. When the item wraps its text in <p>, the first paragraph is the text. */
function splitItem(element: HtmlElement): { lead: HtmlNode[]; nested: HtmlElement[] } {
  const lead: HtmlNode[] = [];
  const nested: HtmlElement[] = [];
  for (const child of element.children) {
    if (isBlock(child)) nested.push(child);
    else lead.push(child);
  }
  if (inlineText(lead).length === 0 && nested[0]?.tag === "p") {
    return { lead: nested[0].children, nested: nested.slice(1) };
  }
  return { lead, nested };
}

/** A leading <strong> becomes the title; the rest, minus a joining colon or dash, is the caption. */
function splitTitle(nodes: readonly HtmlNode[]): { title: HtmlNode[]; caption: HtmlNode[] } {
  const index = nodes.findIndex((node) => node.type !== "text" || node.text.trim().length > 0);
  const first = nodes[index];
  if (!first || first.type !== "element" || (first.tag !== "strong" && first.tag !== "b")) {
    return { title: [], caption: [...nodes] };
  }
  let title = first.children;
  const only = title.length === 1 ? title[0] : undefined;
  if (only?.type === "text") title = [{ type: "text", text: only.text.replace(/\s*[.:]\s*$/, "") }];
  const rest = nodes.slice(index + 1);
  const head = rest[0];
  if (head?.type !== "text") return { title, caption: rest };
  const text = head.text.replace(/^\s*[:.—–-]?\s*/, "");
  return { title, caption: text ? [{ type: "text", text }, ...rest.slice(1)] : rest.slice(1) };
}

/** Strip a leading `+`, `~`, or `-` off a `files` item. */
function splitChangeSign(nodes: readonly HtmlNode[]): { sign: "+" | "~" | "−" | null; rest: HtmlNode[] } {
  const index = nodes.findIndex((node) => node.type !== "text" || node.text.trim().length > 0);
  const first = nodes[index];
  const match = first?.type === "text" ? /^\s*([+~\-−])\s*/.exec(first.text) : null;
  if (!first || first.type !== "text" || !match) return { sign: null, rest: [...nodes] };
  const text = first.text.slice(match[0].length);
  return { sign: CHANGE_SIGNS[match[1]!] ?? null, rest: [...(text ? [{ type: "text" as const, text }] : []), ...nodes.slice(index + 1)] };
}

function nextKey(walk: Walk): string {
  walk.keySeq += 1;
  return `n${walk.keySeq}`;
}

function nextOrdinal(walk: Walk, tag: string): number {
  const counterKey = `${walk.anchorId ?? ""}|${tag}`;
  const ordinal = (walk.counters.get(counterKey) ?? 0) + 1;
  walk.counters.set(counterKey, ordinal);
  return ordinal;
}

function makeLocator(
  ctx: RenderContext,
  walk: Walk,
  element: HtmlElement | null,
  tag: string,
  excerpt: string,
): PlanLocatorBase {
  const elementId = element?.attrs.id?.trim() || null;
  const anchorId = elementId ?? walk.anchorId;
  const ordinal = nextOrdinal(walk, tag);
  const key = elementId ? `#${elementId}` : `${walk.anchorId ?? "_"}/${tag}[${ordinal}]`;
  const locator: PlanLocatorBase = {
    key,
    elementId,
    anchorId,
    headings: walk.headings.map((heading) => heading.text),
    tag,
    ordinal,
    excerpt: excerptOf(excerpt),
  };
  ctx.registry.set(key, locator);
  walk.blockKeys.push(key);
  if (walk.groupDepth === 0) walk.units.push(key);
  return locator;
}

/** Does a block created at this point of the walk get its own rail handle? */
function onRail(walk: Walk): boolean {
  return walk.groupDepth === 0;
}

/** Render `render` as the inside of a component selected as a whole. Returns its output and every block key inside. */
function inGroup<T>(walk: Walk, render: () => T): { rendered: T; keys: string[] } {
  const first = walk.blockKeys.length;
  walk.groupDepth += 1;
  try {
    return { rendered: render(), keys: walk.blockKeys.slice(first) };
  } finally {
    walk.groupDepth -= 1;
  }
}

/** On web, shift-click on a rail handle extends the selection. Native touches never carry modifier keys. */
function isShiftPress(event: GestureResponderEvent): boolean {
  return Boolean((event.nativeEvent as { shiftKey?: boolean }).shiftKey);
}

interface BlockProps {
  ctx: RenderContext;
  locator: PlanLocatorBase;
  revised: string | null;
  /** Has a handle in the comment rail. False inside a component that is selected as a whole. */
  rail: boolean;
  /** Further keys whose comments count on this block's handle: the blocks inside a component. */
  innerKeys?: readonly string[];
  /** Merged over the default row frame, e.g. for chips and flow boxes. */
  frame?: StyleProp<ViewStyle>;
  /** Replaces the default content style. */
  contentStyle?: StyleProp<ViewStyle>;
  chosen?: boolean;
  children: ReactNode;
}

/**
 * One commentable unit. The content itself is inert, so links, toggles, and text selection inside it work
 * as usual; selecting it for a comment happens on its handle in the rail on the right.
 */
function Block({ ctx, locator, revised, rail, innerKeys, frame, contentStyle, chosen = false, children }: BlockProps) {
  const { styles } = ctx;
  // Pointer over the content hints at the handle; pointer over the handle previews the selection.
  const [pointerOver, setPointerOver] = useState(false);
  const [railHovered, setRailHovered] = useState(false);
  const selected = rail && ctx.selectedKeys.has(locator.key);
  const isRevised = revised !== null && revised.length > 0 && revised === ctx.revision;
  const body = (
    <View
      nativeID={blockElementId(locator.key)}
      onPointerEnter={rail ? () => setPointerOver(true) : undefined}
      onPointerLeave={rail ? () => setPointerOver(false) : undefined}
      style={[
        styles.block,
        rail ? styles.unitBody : null,
        frame,
        chosen ? styles.blockChosen : null,
        railHovered ? styles.blockHovered : null,
        selected ? styles.blockSelected : null,
      ]}
    >
      <View style={contentStyle ?? styles.blockContent}>{children}</View>
      {isRevised || chosen ? (
        <View style={styles.badges}>
          {chosen ? <Text style={styles.chosenLabel}>chosen</Text> : null}
          {isRevised ? <Text style={styles.revised}>updated</Text> : null}
        </View>
      ) : null}
    </View>
  );
  if (!rail) return body;
  const count = [locator.key, ...(innerKeys ?? [])].reduce((sum, key) => sum + (ctx.commentCounts[key] ?? 0), 0);
  return (
    <View style={styles.unit}>
      {body}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`Select ${describeBlock(locator)} for a comment`}
        hitSlop={RAIL_HIT_SLOP}
        onPress={(event) => ctx.onToggleUnit(locator.key, isShiftPress(event))}
        onHoverIn={() => setRailHovered(true)}
        onHoverOut={() => setRailHovered(false)}
        style={styles.rail}
      >
        {count > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText} selectable={false}>
              {count}
            </Text>
          </View>
        ) : null}
        <View
          style={[
            styles.railBar,
            pointerOver ? styles.railBarHint : null,
            railHovered ? styles.railBarHovered : null,
            selected ? styles.railBarSelected : null,
          ]}
        />
      </Pressable>
    </View>
  );
}

function renderInline(nodes: readonly HtmlNode[], ctx: RenderContext, walk: Walk): ReactNode[] {
  const { styles } = ctx;
  const out: ReactNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      out.push(collapse(node.text));
      continue;
    }
    const key = nextKey(walk);
    switch (node.tag) {
      case "br":
        out.push("\n");
        break;
      case "strong":
      case "b":
        out.push(
          <Text key={key} style={styles.strong}>
            {renderInline(node.children, ctx, walk)}
          </Text>,
        );
        break;
      case "em":
      case "i":
      case "cite":
      case "var":
      case "dfn":
        out.push(
          <Text key={key} style={styles.em}>
            {renderInline(node.children, ctx, walk)}
          </Text>,
        );
        break;
      case "code":
      case "kbd":
      case "samp":
      case "tt":
        out.push(
          <Text key={key} style={styles.code}>
            {renderInline(node.children, ctx, walk)}
          </Text>,
        );
        break;
      case "del":
      case "s":
      case "strike":
        out.push(
          <Text key={key} style={styles.del}>
            {renderInline(node.children, ctx, walk)}
          </Text>,
        );
        break;
      case "mark":
        out.push(
          <Text key={key} style={styles.mark}>
            {renderInline(node.children, ctx, walk)}
          </Text>,
        );
        break;
      case "small":
      case "sub":
      case "sup":
        out.push(
          <Text key={key} style={styles.small}>
            {renderInline(node.children, ctx, walk)}
          </Text>,
        );
        break;
      case "a": {
        const href = node.attrs.href ?? "";
        const external = /^https?:\/\//i.test(href);
        out.push(
          <Text
            key={key}
            style={styles.link}
            accessibilityRole={external ? "link" : undefined}
            onPress={external ? () => void openExternalUrl(href) : undefined}
          >
            {renderInline(node.children, ctx, walk)}
          </Text>,
        );
        break;
      }
      case "img":
        out.push(
          <Text key={key} style={styles.image}>
            {node.attrs.alt ? `[image: ${node.attrs.alt}]` : "[image]"}
          </Text>,
        );
        break;
      case "span": {
        const classes = classesOf(node);
        const tone = toneOf(classes);
        if (!tone && !classes.has("tag")) {
          out.push(<Text key={key}>{renderInline(node.children, ctx, walk)}</Text>);
          break;
        }
        // A tag: a small tinted label. Thin spaces pad it, since nested Text takes no padding.
        const color = tone ? toneColor(ctx.theme, tone) : ctx.theme.colors.foregroundMuted;
        out.push(
          <Text key={key} style={[styles.tag, { color, backgroundColor: tint(color, 0.15) }]}>
            {" "}
            {renderInline(node.children, ctx, walk)}
            {" "}
          </Text>,
        );
        break;
      }
      default:
        if (SKIPPED_TAGS.has(node.tag)) break;
        // Unknown inline tags, and blocks nested where inline content was expected: keep their text.
        out.push(<Text key={key}>{renderInline(node.children, ctx, walk)}</Text>);
    }
  }
  // Trim whitespace at the edges of the run.
  const first = out[0];
  if (typeof first === "string") out[0] = first.replace(/^\s+/, "");
  const last = out[out.length - 1];
  if (typeof last === "string") out[out.length - 1] = last.replace(/\s+$/, "");
  return out;
}

/** A title line over a muted caption, or plain text when there is no leading <strong>. */
function renderTitled(
  nodes: readonly HtmlNode[],
  titleStyle: TextStyle,
  captionStyle: TextStyle,
  ctx: RenderContext,
  walk: Walk,
): ReactNode {
  const { title, caption } = splitTitle(nodes);
  if (title.length === 0) {
    return (
      <Text style={ctx.styles.text} selectable>
        {renderInline(caption, ctx, walk)}
      </Text>
    );
  }
  return (
    <>
      <Text style={titleStyle} selectable>
        {renderInline(title, ctx, walk)}
      </Text>
      {inlineText(caption).length > 0 ? (
        <Text style={captionStyle} selectable>
          {renderInline(caption, ctx, walk)}
        </Text>
      ) : null}
    </>
  );
}

function inlineRun(
  nodes: readonly HtmlNode[],
  ctx: RenderContext,
  walk: Walk,
  textStyle: TextStyle,
  element: HtmlElement | null,
  tag: string,
): ReactNode | null {
  const text = inlineText(nodes);
  if (text.length === 0) return null;
  const locator = makeLocator(ctx, walk, element, tag, text);
  return (
    <Block key={nextKey(walk)} ctx={ctx} locator={locator} rail={onRail(walk)} revised={revisedOf(element)}>
      <Text style={textStyle} selectable>
        {renderInline(nodes, ctx, walk)}
      </Text>
    </Block>
  );
}

/** Render mixed content: inline runs become pressable paragraphs, blocks render recursively. */
function renderNodes(nodes: readonly HtmlNode[], ctx: RenderContext, walk: Walk): ReactNode[] {
  const out: ReactNode[] = [];
  let run: HtmlNode[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const rendered = inlineRun(run, ctx, walk, ctx.styles.text, null, "p");
    if (rendered) out.push(rendered);
    run = [];
  };
  for (const node of nodes) {
    if (node.type === "element" && SKIPPED_TAGS.has(node.tag)) continue;
    if (isBlock(node)) {
      flush();
      const rendered = renderBlock(node, ctx, walk);
      if (rendered) out.push(rendered);
    } else {
      run.push(node);
    }
  }
  flush();
  return out;
}

function withAnchor<T>(walk: Walk, element: HtmlElement, render: () => T): T {
  const id = element.attrs.id?.trim();
  if (!id) return render();
  const previous = walk.anchorId;
  walk.anchorId = id;
  try {
    return render();
  } finally {
    walk.anchorId = previous;
  }
}

function listItems(element: HtmlElement): HtmlElement[] {
  return element.children.filter((child): child is HtmlElement => isElement(child, "li"));
}

function renderList(element: HtmlElement, ctx: RenderContext, walk: Walk): ReactNode {
  const classes = classesOf(element);
  if (classes.has("steps")) return renderSteps(element, ctx, walk);
  if (classes.has("flow")) return renderFlow(element, ctx, walk);
  if (classes.has("facts")) return renderFacts(element, ctx, walk);
  const { styles } = ctx;
  const ordered = element.tag === "ol";
  const start = Number.parseInt(element.attrs.start ?? "1", 10);
  let index = Number.isFinite(start) ? start : 1;
  const items: ReactNode[] = [];
  return withAnchor(walk, element, () => {
    for (const child of element.children) {
      if (child.type !== "element" || child.tag !== "li") {
        if (child.type === "element") {
          const rendered = renderBlock(child, ctx, walk);
          if (rendered) items.push(rendered);
        }
        continue;
      }
      const itemClasses = classesOf(child);
      const tone = toneOf(itemClasses);
      let marker: ItemMarker;
      if (classes.has("checks")) marker = { kind: "check", done: itemClasses.has("done") };
      else if (classes.has("files")) marker = { kind: "file" };
      else if (tone) marker = { kind: "tone", tone };
      else marker = { kind: "text", text: ordered ? `${index}.` : "•" };
      index += 1;
      items.push(renderListItem(child, marker, ctx, walk));
    }
    return (
      <View key={nextKey(walk)} style={styles.list}>
        {items}
      </View>
    );
  });
}

function renderMarker(marker: ItemMarker, ctx: RenderContext): ReactNode {
  const { styles } = ctx;
  switch (marker.kind) {
    case "text":
      return (
        <Text style={styles.marker} selectable={false}>
          {marker.text}
        </Text>
      );
    case "tone":
      return (
        <View style={styles.markerBox}>
          <ToneMarker tone={marker.tone} theme={ctx.theme} styles={styles} />
        </View>
      );
    case "check":
      return (
        <View style={styles.markerBox}>
          <CheckBox done={marker.done} styles={styles} />
        </View>
      );
    case "file":
      return null;
  }
}

function renderListItem(element: HtmlElement, marker: ItemMarker, ctx: RenderContext, walk: Walk): ReactNode {
  const { styles, theme } = ctx;
  return withAnchor(walk, element, () => {
    const { nested, lead: itemLead } = splitItem(element);
    let lead = itemLead;
    let markerNode = renderMarker(marker, ctx);
    let textStyle = styles.text;
    if (marker.kind === "file") {
      const split = splitChangeSign(lead);
      lead = split.rest;
      const color =
        split.sign === "+"
          ? theme.colors.statusSuccess
          : split.sign === "~"
            ? theme.colors.statusWarning
            : split.sign === "−"
              ? theme.colors.statusDanger
              : theme.colors.foregroundMuted;
      markerNode = (
        <Text style={[styles.fileSign, { color }]} selectable={false}>
          {split.sign ?? "·"}
        </Text>
      );
      textStyle = styles.fileText;
    }
    const locator = makeLocator(ctx, walk, element, "li", inlineText(lead));
    const leadBlock = (
      <Block
        key={nextKey(walk)}
        ctx={ctx}
        locator={locator}
        rail={onRail(walk)}
        revised={revisedOf(element)}
        chosen={classesOf(element).has("chosen")}
      >
        <View style={styles.listItem}>
          {markerNode}
          <Text style={[textStyle, { flex: 1 }]} selectable>
            {renderInline(lead, ctx, walk)}
          </Text>
        </View>
      </Block>
    );
    if (nested.length === 0) return leadBlock;
    return (
      <View key={nextKey(walk)}>
        {leadBlock}
        <View style={styles.nested}>{nested.map((child) => renderBlock(child, ctx, walk))}</View>
      </View>
    );
  });
}

/** `ol.steps`: a numbered timeline. `done` and `doing` on an item show progress during implementation. */
function renderSteps(element: HtmlElement, ctx: RenderContext, walk: Walk): ReactNode {
  const { styles, theme } = ctx;
  const start = Number.parseInt(element.attrs.start ?? "1", 10);
  const first = Number.isFinite(start) ? start : 1;
  const items = listItems(element);
  return withAnchor(walk, element, () => (
    <View key={nextKey(walk)}>
      {items.map((item, index) =>
        withAnchor(walk, item, () => {
          const classes = classesOf(item);
          const done = classes.has("done");
          const doing = !done && classes.has("doing");
          const tone = toneOf(classes);
          const toneTint = tone && !done && !doing ? toneColor(theme, tone) : null;
          const { lead, nested } = splitItem(item);
          const locator = makeLocator(ctx, walk, item, "li", inlineText(lead));
          const dot: StyleProp<ViewStyle> = done
            ? { backgroundColor: theme.colors.statusSuccess, borderColor: theme.colors.statusSuccess }
            : doing
              ? { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }
              : toneTint
                ? { backgroundColor: tint(toneTint, 0.15), borderColor: toneTint }
                : null;
          const numberColor = done
            ? theme.colors.surface0
            : doing
              ? theme.colors.accentForeground
              : (toneTint ?? theme.colors.foreground);
          return (
            <View key={nextKey(walk)} style={styles.stepRow}>
              <View style={styles.stepRail}>
                <View style={[styles.stepDot, dot]}>
                  <Text style={[styles.stepNumber, { color: numberColor }]} selectable={false}>
                    {done ? "✓" : first + index}
                  </Text>
                </View>
                {index < items.length - 1 ? <View style={[styles.stepLine, done ? styles.stepLineDone : null]} /> : null}
              </View>
              <View style={styles.stepBody}>
                <Block ctx={ctx} locator={locator} rail={onRail(walk)} revised={revisedOf(item)} chosen={classes.has("chosen")}>
                  {renderTitled(lead, styles.stepTitle, styles.stepCaption, ctx, walk)}
                </Block>
                {nested.map((child) => renderBlock(child, ctx, walk))}
              </View>
            </View>
          );
        }),
      )}
    </View>
  ));
}

/**
 * `ol.flow`: boxes joined by arrows, for data flow, request flow, or user journeys. Selected as a whole,
 * since boxes side by side cannot each have a handle in the rail.
 */
function renderFlow(element: HtmlElement, ctx: RenderContext, walk: Walk): ReactNode {
  const { styles, theme } = ctx;
  const items = listItems(element);
  const excerpt = items.map((item) => inlineText(splitItem(item).lead)).join(" → ");
  const locator = makeLocator(ctx, walk, element, "ol.flow", excerpt);
  const rail = onRail(walk);
  const { rendered: boxes, keys } = inGroup(walk, () =>
    withAnchor(walk, element, () =>
      items.map((item) =>
      withAnchor(walk, item, () => {
        const classes = classesOf(item);
        const tone = toneOf(classes);
        const color = tone ? toneColor(theme, tone) : null;
        const { lead, nested } = splitItem(item);
        const locator = makeLocator(ctx, walk, item, "li", inlineText(lead));
        return (
          <View key={nextKey(walk)} style={styles.flowCell}>
            <Block
              ctx={ctx}
              locator={locator}
              rail={onRail(walk)}
              revised={revisedOf(item)}
              chosen={classes.has("chosen")}
              frame={[styles.flowBox, color ? { borderColor: color, borderLeftColor: color, backgroundColor: tint(color, 0.1) } : null]}
            >
              {renderTitled(lead, styles.flowTitle, styles.flowCaption, ctx, walk)}
            </Block>
            {nested.map((child) => renderBlock(child, ctx, walk))}
          </View>
        );
      }),
      ),
    ),
  );
  return (
    <Block key={nextKey(walk)} ctx={ctx} locator={locator} rail={rail} innerKeys={keys} revised={revisedOf(element)}>
      <FlowLayout items={boxes} styles={styles} />
    </Block>
  );
}

/** `ul.facts`: a row of chips; a leading <strong> is the chip's label. Selected as a whole, like a flow. */
function renderFacts(element: HtmlElement, ctx: RenderContext, walk: Walk): ReactNode {
  const { styles, theme } = ctx;
  const items = listItems(element);
  const excerpt = items.map((item) => inlineText(splitItem(item).lead)).join(" · ");
  const locator = makeLocator(ctx, walk, element, "ul.facts", excerpt);
  const rail = onRail(walk);
  const { rendered: chips, keys } = inGroup(walk, () =>
    withAnchor(walk, element, () =>
      items.map((item) =>
        withAnchor(walk, item, () => {
          const tone = toneOf(classesOf(item));
          const color = tone ? toneColor(theme, tone) : null;
          const { lead } = splitItem(item);
          const locator = makeLocator(ctx, walk, item, "li", inlineText(lead));
          const { title, caption } = splitTitle(lead);
          return (
            <Block
              key={nextKey(walk)}
              ctx={ctx}
              locator={locator}
              rail={onRail(walk)}
              revised={revisedOf(item)}
              frame={[styles.chip, color ? { borderColor: color, borderLeftColor: color, backgroundColor: tint(color, 0.12) } : null]}
              contentStyle={styles.chipContent}
            >
              <Text style={[styles.chipText, color ? { color } : null]} selectable>
                {title.length > 0 ? (
                  <Text style={styles.chipLabel}>
                    {renderInline(title, ctx, walk)}
                    {"  "}
                  </Text>
                ) : null}
                {renderInline(caption, ctx, walk)}
              </Text>
            </Block>
          );
        }),
      ),
    ),
  );
  return (
    <Block
      key={nextKey(walk)}
      ctx={ctx}
      locator={locator}
      rail={rail}
      innerKeys={keys}
      revised={revisedOf(element)}
      contentStyle={[styles.blockContent, styles.facts]}
    >
      {chips}
    </Block>
  );
}

/** `dl`: one row per term, the term in a muted left column. */
function renderDefinitions(element: HtmlElement, ctx: RenderContext, walk: Walk): ReactNode {
  const { styles } = ctx;
  const pairs: { term: HtmlElement | null; details: HtmlElement[] }[] = [];
  const collect = (node: HtmlElement) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (child.tag === "dt") pairs.push({ term: child, details: [] });
      else if (child.tag === "dd") {
        const last = pairs[pairs.length - 1];
        if (last) last.details.push(child);
        else pairs.push({ term: null, details: [child] });
      } else if (child.tag === "div") collect(child);
    }
  };
  collect(element);
  return withAnchor(walk, element, () => (
    <View key={nextKey(walk)} style={styles.kv}>
      {pairs.map(({ term, details }) => {
        const parts = term ? [term, ...details] : details;
        const owner = parts.find((part) => part.attrs.id) ?? parts[0]!;
        // Inline content fills the value column; blocks such as `details` go below the row.
        const values = details.map((detail) => splitItem(detail));
        const termText = term ? inlineText(term.children) : "";
        const valueText = values.map((value) => inlineText(value.lead)).join(" ");
        return withAnchor(walk, owner, () => {
          const locator = makeLocator(ctx, walk, owner, "dt", termText ? `${termText}: ${valueText}` : valueText);
          const revised = parts.some((part) => revisedOf(part) === ctx.revision) ? ctx.revision : null;
          const row = (
            <Block
              key={nextKey(walk)}
              ctx={ctx}
              locator={locator}
              rail={onRail(walk)}
              revised={revised}
              chosen={parts.some((part) => classesOf(part).has("chosen"))}
            >
              <View style={styles.kvRow}>
                <Text style={styles.kvKey} selectable>
                  {term ? renderInline(term.children, ctx, walk) : ""}
                </Text>
                <View style={styles.kvValue}>
                  {values.map((value) =>
                    inlineText(value.lead).length > 0 ? (
                      <Text key={nextKey(walk)} style={styles.text} selectable>
                        {renderInline(value.lead, ctx, walk)}
                      </Text>
                    ) : null,
                  )}
                </View>
              </View>
            </Block>
          );
          const nested = values.flatMap((value) => value.nested);
          if (nested.length === 0) return row;
          return (
            <View key={nextKey(walk)}>
              {row}
              <View style={styles.kvNested}>{nested.map((child) => renderBlock(child, ctx, walk))}</View>
            </View>
          );
        });
      })}
    </View>
  ));
}

/** `.compare`: children side by side as columns (before/after, in/out of scope, options). */
function renderCompare(element: HtmlElement, ctx: RenderContext, walk: Walk): ReactNode {
  const { styles, theme } = ctx;
  return withAnchor(walk, element, () => {
    // Headings inside one column must not leak into the next column's breadcrumb.
    const headings = walk.headings;
    const columns = element.children.filter(
      (child): child is HtmlElement => child.type === "element" && !SKIPPED_TAGS.has(child.tag),
    );
    const rendered = (
      <View key={nextKey(walk)} style={styles.compare}>
        {columns.map((column) => {
          walk.headings = headings;
          const classes = classesOf(column);
          const tone = toneOf(classes);
          const content = COLUMN_CONTAINERS.has(column.tag)
            ? withAnchor(walk, column, () => renderNodes(column.children, ctx, walk))
            : [renderBlock(column, ctx, walk)];
          return (
            <View
              key={nextKey(walk)}
              style={[
                styles.column,
                tone ? { borderTopWidth: 3, borderTopColor: toneColor(theme, tone) } : null,
                classes.has("chosen") ? styles.columnChosen : null,
              ]}
            >
              {classes.has("chosen") ? <Text style={styles.chosenLabel}>✓ chosen</Text> : null}
              {content}
            </View>
          );
        })}
      </View>
    );
    walk.headings = headings;
    return rendered;
  });
}

/** `aside`: a tinted callout, `note` unless it carries another tone. Selected as a whole. */
function renderCallout(element: HtmlElement, ctx: RenderContext, walk: Walk): ReactNode {
  const { styles, theme } = ctx;
  const tone = toneOf(classesOf(element)) ?? "note";
  const color = toneColor(theme, tone);
  const locator = makeLocator(ctx, walk, element, "aside", flatText(element.children));
  const rail = onRail(walk);
  const { rendered: content, keys } = inGroup(walk, () =>
    withAnchor(walk, element, () => renderNodes(element.children, ctx, walk)),
  );
  return (
    <Block key={nextKey(walk)} ctx={ctx} locator={locator} rail={rail} innerKeys={keys} revised={revisedOf(element)}>
      <View style={[styles.callout, { borderLeftColor: color, backgroundColor: tint(color, 0.08) }]}>
        <View style={styles.calloutMarker}>
          <ToneMarker tone={tone} theme={theme} styles={styles} />
        </View>
        <View style={styles.calloutBody}>{content}</View>
      </View>
    </Block>
  );
}

/**
 * `details`: collapsed by default. Hidden content is still walked so that ordinals, and with them the
 * comment keys of blocks without an id, do not depend on what the user expanded.
 */
function renderDetails(element: HtmlElement, ctx: RenderContext, walk: Walk): ReactNode {
  const id = element.attrs.id?.trim();
  const ordinal = nextOrdinal(walk, "details");
  const key = id ? `#${id}` : `${walk.anchorId ?? "_"}/details[${ordinal}]`;
  return withAnchor(walk, element, () => {
    const summary = element.children.find((child): child is HtmlElement => isElement(child, "summary"));
    const body = element.children.filter((child) => child !== summary);
    const label = summary ? renderInline(summary.children, ctx, walk) : "Details";
    const firstInner = walk.blockKeys.length;
    const firstUnit = walk.units.length;
    const content = renderNodes(body, ctx, walk);
    const innerKeys = walk.blockKeys.slice(firstInner);
    const comments = innerKeys.reduce((sum, innerKey) => sum + (ctx.commentCounts[innerKey] ?? 0), 0);
    const revisedInside =
      ctx.revision !== null && findElements(element, (node) => revisedOf(node) === ctx.revision).length > 0;
    const selectedInside = innerKeys.some((innerKey) => ctx.selectedKeys.has(innerKey));
    const open = ctx.isOpen(key, element.attrs.open !== undefined || revisedInside || selectedInside);
    // Handles inside a collapsed block are off screen, so a shift-click range skips them.
    if (!open) walk.units.length = firstUnit;
    return (
      <Collapsible
        key={nextKey(walk)}
        open={open}
        onToggle={() => ctx.setOpen(key, !open)}
        label={label}
        hiddenComments={open ? 0 : comments}
        styles={ctx.styles}
      >
        {content}
      </Collapsible>
    );
  });
}

function renderTable(element: HtmlElement, ctx: RenderContext, walk: Walk): ReactNode {
  const { styles } = ctx;
  const rows: { row: HtmlElement; header: boolean }[] = [];
  const collect = (node: HtmlElement, header: boolean) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (child.tag === "tr") rows.push({ row: child, header });
      else if (child.tag === "thead") collect(child, true);
      else if (child.tag === "tbody" || child.tag === "tfoot") collect(child, header);
    }
  };
  collect(element, false);
  return withAnchor(walk, element, () => (
    <View key={nextKey(walk)}>
      {rows.map(({ row, header }, rowIndex) => {
        const cells = row.children.filter(
          (child): child is HtmlElement => child.type === "element" && (child.tag === "td" || child.tag === "th"),
        );
        const text = cells.map((cell) => inlineText(cell.children)).join(" | ");
        const locator = makeLocator(ctx, walk, row, "tr", text);
        const chosen = classesOf(row).has("chosen");
        const corners = [rowIndex === 0 ? styles.rowTop : null, rowIndex === rows.length - 1 ? styles.rowBottom : null];
        return (
          <Block
            key={nextKey(walk)}
            ctx={ctx}
            locator={locator}
            rail={onRail(walk)}
            revised={revisedOf(row)}
            frame={[styles.rowBlock, chosen ? styles.blockChosen : null, corners]}
          >
            <View style={[styles.row, corners, rowIndex === rows.length - 1 ? styles.lastRow : null]}>
              {cells.map((cell, cellIndex) => {
                const isHeader = header || cell.tag === "th";
                return (
                  <View key={nextKey(walk)} style={[styles.cell, isHeader ? styles.headerCell : null]}>
                    <Text style={isHeader ? styles.th : styles.td} selectable>
                      {chosen && cellIndex === 0 ? <Text style={styles.chosenMark}>✓ </Text> : null}
                      {renderInline(cell.children, ctx, walk)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Block>
        );
      })}
    </View>
  ));
}

function renderBlock(element: HtmlElement, ctx: RenderContext, walk: Walk): ReactNode | null {
  const { styles } = ctx;
  const tag = element.tag;
  const level = HEADING_LEVEL[tag];
  if (level !== undefined) {
    const text = inlineText(element.children);
    const locator = makeLocator(ctx, walk, element, tag, text);
    const style = level === 1 ? styles.h1 : level === 2 ? styles.h2 : level === 3 ? styles.h3 : styles.h4;
    const rendered = (
      <Block key={nextKey(walk)} ctx={ctx} locator={locator} rail={onRail(walk)} revised={revisedOf(element)}>
        <Text style={style} selectable accessibilityRole="header">
          {renderInline(element.children, ctx, walk)}
        </Text>
      </Block>
    );
    // Children of this heading see it in their breadcrumb.
    walk.headings = walk.headings.filter((heading) => heading.level < level);
    if (text.length > 0) walk.headings.push({ level, text });
    return rendered;
  }
  switch (tag) {
    case "p":
    case "dt":
    case "dd":
    case "address":
    case "figcaption":
      return inlineRun(element.children, ctx, walk, styles.text, element, tag === "p" ? "p" : tag);
    case "summary":
      return inlineRun(element.children, ctx, walk, styles.summary, element, "summary");
    case "pre": {
      const text = rawText(element.children);
      if (text.trim().length === 0) return null;
      const locator = makeLocator(ctx, walk, element, "pre", text);
      return (
        <Block key={nextKey(walk)} ctx={ctx} locator={locator} rail={onRail(walk)} revised={revisedOf(element)}>
          <View style={styles.preBox}>
            <Text style={styles.pre} selectable>
              {text}
            </Text>
          </View>
        </Block>
      );
    }
    case "ul":
    case "ol":
      return renderList(element, ctx, walk);
    case "li":
      return renderListItem(element, { kind: "text", text: "•" }, ctx, walk);
    case "dl":
      return renderDefinitions(element, ctx, walk);
    case "details":
      return renderDetails(element, ctx, walk);
    case "aside":
      return renderCallout(element, ctx, walk);
    case "table":
      return renderTable(element, ctx, walk);
    case "hr":
      return <View key={nextKey(walk)} style={styles.hr} />;
    case "img":
      return (
        <Text key={nextKey(walk)} style={styles.image}>
          {element.attrs.alt ? `[image: ${element.attrs.alt}]` : "[image]"}
        </Text>
      );
    case "blockquote":
      return withAnchor(walk, element, () => (
        <View key={nextKey(walk)} style={styles.quote}>
          {renderNodes(element.children, ctx, walk)}
        </View>
      ));
    case "thead":
    case "tbody":
    case "tfoot":
    case "tr":
      // Rows outside a table: render their text.
      return inlineRun(element.children, ctx, walk, styles.text, element, "p");
    default:
      // section, article, div, header, footer, main, nav, figure, form, fieldset
      if (classesOf(element).has("compare")) return renderCompare(element, ctx, walk);
      return withAnchor(walk, element, () => (
        <View key={nextKey(walk)} style={[styles.section, tag === "header" ? styles.header : null]}>
          {renderNodes(element.children, ctx, walk)}
        </View>
      ));
  }
}

export function PlanView({
  body,
  revision,
  theme,
  compact,
  commentCounts,
  selectedKeys,
  onSelectionChange,
  registry,
}: PlanViewProps) {
  const styles = useMemo(() => createStyles(theme, compact), [theme, compact]);
  // Expanded state of `details` blocks, keyed like comments so it survives plan revisions.
  const [openDetails, setOpenDetails] = useState<Readonly<Record<string, boolean>>>({});
  const setOpen = useCallback((key: string, open: boolean) => {
    setOpenDetails((previous) => ({ ...previous, [key]: open }));
  }, []);
  // Visible rail handles in document order as of the last render, and where a shift-click range starts.
  const unitsRef = useRef<readonly string[]>([]);
  const rangeStartRef = useRef<string | null>(null);
  const onToggleUnit = (key: string, extend: boolean) => {
    const units = unitsRef.current;
    const from = rangeStartRef.current === null ? -1 : units.indexOf(rangeStartRef.current);
    const to = units.indexOf(key);
    const next = new Set(selectedKeys);
    if (extend && from >= 0 && to >= 0) {
      // The browser treats shift-click as extending its text selection too; drop that so no text gets highlighted.
      clearPlanSelection();
      for (const unit of units.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(unit);
    } else {
      if (next.has(key)) next.delete(key);
      else next.add(key);
      rangeStartRef.current = key;
    }
    onSelectionChange(next);
  };
  registry.clear();
  const ctx: RenderContext = {
    theme,
    styles,
    revision,
    commentCounts,
    selectedKeys,
    onToggleUnit,
    registry,
    isOpen: (key, fallback) => openDetails[key] ?? fallback,
    setOpen,
  };
  const walk: Walk = {
    headings: [],
    anchorId: null,
    counters: new Map(),
    keySeq: 0,
    blockKeys: [],
    units: [],
    groupDepth: 0,
  };
  const rendered = renderNodes(body.children, ctx, walk);
  unitsRef.current = walk.units;
  if (rendered.length === 0) {
    return <Text style={[styles.text, styles.muted]}>This plan has no readable content.</Text>;
  }
  return <View style={styles.document}>{rendered}</View>;
}
