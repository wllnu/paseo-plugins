import { CATEGORY_LABELS } from "../shared/estimate";

type Theme = { colors: { surface0: string; foregroundMuted: string } };

// Categorical palette checked for color-blind separation, in this order, on light and dark
// surfaces: blue, orange, aqua, yellow, magenta, green, violet, red.
const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const [BLUE, ORANGE, AQUA, YELLOW, MAGENTA, GREEN, VIOLET] = [0, 1, 2, 3, 4, 5, 6];

// Colors follow the category, never its size. Tool output gets its own hues, the conversation
// shares green and the fixed setup shares violet, in lighter shades; labels always name the row.
const CATEGORY_COLORS: Record<string, [slot: number, opacity: number]> = {
  [CATEGORY_LABELS.reads]: [BLUE, 1],
  [CATEGORY_LABELS.shell]: [ORANGE, 1],
  [CATEGORY_LABELS.search]: [AQUA, 1],
  [CATEGORY_LABELS.web]: [AQUA, 0.55],
  [CATEGORY_LABELS.edits]: [YELLOW, 1],
  [CATEGORY_LABELS.subagents]: [MAGENTA, 1],
  [CATEGORY_LABELS.tools]: [MAGENTA, 0.55],
  [CATEGORY_LABELS.user]: [GREEN, 1],
  [CATEGORY_LABELS.assistant]: [GREEN, 0.6],
  [CATEGORY_LABELS.reasoning]: [GREEN, 0.35],
  // Labels from server/fixed.ts, plus the panel's stand-in when the split is unavailable.
  "System prompt": [VIOLET, 1],
  "System prompt, tools and memory": [VIOLET, 1],
  "Built-in tools": [VIOLET, 0.75],
  "MCP and deferred tools": [VIOLET, 0.55],
  "MCP server instructions": [VIOLET, 0.55],
  "Skills list": [VIOLET, 0.4],
  "Subagent types": [VIOLET, 0.4],
  "Memory files": [VIOLET, 0.3],
  "Environment and reminders": [VIOLET, 0.3],
};

/** The theme has no light/dark flag, so judge by the base surface. */
function isDark(theme: Theme) {
  const hex = /^#([0-9a-f]{6})$/i.exec(theme.colors.surface0)?.[1];
  if (!hex) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Fill for a category, by its display label. Unknown labels and "Not accounted for" go gray. */
export function categoryColor(label: string, theme: Theme) {
  const entry = CATEGORY_COLORS[label];
  if (!entry) return { backgroundColor: theme.colors.foregroundMuted, opacity: 0.5 };
  const [slot, opacity] = entry;
  return { backgroundColor: PALETTE[isDark(theme) ? "dark" : "light"][slot], opacity };
}
