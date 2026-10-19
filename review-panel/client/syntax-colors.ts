import type { PluginTheme } from "@getpaseo/plugin";

// Copied from @getpaseo/highlight (colors.ts): plugin client bundles can only import host-provided modules.
// Paseo uses these two maps for every dark theme and for the light theme, so the diff tab and this panel
// color code the same way.
const DARK: Record<string, string> = {
  keyword: "#ff7b72",
  comment: "#8b949e",
  string: "#a5d6ff",
  number: "#79c0ff",
  literal: "#79c0ff",
  function: "#d2a8ff",
  definition: "#d2a8ff",
  class: "#ffa657",
  type: "#ff7b72",
  tag: "#7ee787",
  attribute: "#79c0ff",
  property: "#79c0ff",
  variable: "#c9d1d9",
  operator: "#79c0ff",
  punctuation: "#c9d1d9",
  regexp: "#a5d6ff",
  escape: "#79c0ff",
  meta: "#8b949e",
  heading: "#79c0ff",
  link: "#a5d6ff",
};

const LIGHT: Record<string, string> = {
  keyword: "#cf222e",
  comment: "#6e7781",
  string: "#0a3069",
  number: "#0550ae",
  literal: "#0550ae",
  function: "#8250df",
  definition: "#8250df",
  class: "#953800",
  type: "#cf222e",
  tag: "#116329",
  attribute: "#0550ae",
  property: "#0550ae",
  variable: "#24292f",
  operator: "#0550ae",
  punctuation: "#24292f",
  regexp: "#0a3069",
  escape: "#0550ae",
  meta: "#6e7781",
  heading: "#0550ae",
  link: "#0a3069",
};

/** Relative luminance 0–1 of a hex or rgb() color; null for anything else (named colors, hsl). */
function luminance(color: string): number | null {
  const value = color.trim().toLowerCase();
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex.slice(0, 3)].map((digit) => digit + digit).join("") : hex.slice(0, 6);
    rgb = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  } else {
    const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value);
    if (match) rgb = match.slice(1, 4).map(Number);
  }
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The syntax palette for the theme on screen: PluginTheme has no appearance flag, so judge by the surface. */
export function syntaxColors(theme: PluginTheme): Record<string, string> {
  const surface = luminance(theme.colors.surface0);
  return surface !== null && surface > 0.5 ? LIGHT : DARK;
}
