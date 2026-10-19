// Run: node --experimental-strip-types server/rules.check.ts
import { readFile } from "node:fs/promises";
import { appliesTo, globToRegExp, loadRulesets, parseRuleset } from "./rules.ts";

function equal(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const file = new URL("../examples/ui.md", import.meta.url).pathname;
const ui = parseRuleset(await readFile(file, "utf8"), file);

equal(ui.id, "ui", "id");
equal(ui.title, "UI rules", "title");
equal(ui.paths, ["**/*.tsx", "**/*.css"], "paths");
equal(
  ui.rules.map((rule) => rule.id),
  ["ui/theme-colors", "ui/pressable-label", "ui/compact-layout"],
  "rule ids",
);
equal(ui.rules[0].rule, "Take every color from `theme.colors`.", "rule sentence");
equal(
  ui.rules[0].violatedWhen,
  "a style sets a color with a hex, rgb, or named literal.",
  "violated when",
);
equal(ui.rules[0].bad, '<Text style={{ color: "#fff" }}>Saved</Text>', "bad example");
equal(ui.rules[1].good.split("\n").length, 3, "multi-line good example");
equal(ui.rules[2].severity, "warning", "severity");

equal(appliesTo(ui, "src/components/Card.tsx"), true, "tsx matches");
equal(appliesTo(ui, "Card.tsx"), true, "tsx at the root matches");
equal(appliesTo(ui, "src/server/db.ts"), false, "ts does not match");
equal(appliesTo({ ...ui, paths: [] }, "anything.go"), true, "no paths matches every file");
equal(globToRegExp("*.tsx").test("a/b/c.tsx"), true, "glob without a slash matches at any depth");
equal(globToRegExp("src/*.ts").test("src/a/b.ts"), false, "* stays inside one directory");
equal(globToRegExp("src/**/*.{ts,tsx}").test("src/a/b.tsx"), true, "braces");
equal(globToRegExp("src/**/*.{ts,tsx}").test("src/b.ts"), true, "**/ matches zero directories");
equal(globToRegExp("a.b").test("axb"), false, "dots are literal");

// A code line that looks like a field must not override the real field.
const tricky = parseRuleset(
  "---\nid: t\n---\n## t/one\nRule: real rule\nViolated when: v\nFollowed when: f\n\nBad:\n```css\nRule: fake\n```\n",
  "tricky.md",
);
equal(tricky.rules[0].rule, "real rule", "first field wins");
equal(tricky.rules[0].bad, "Rule: fake", "example body");
equal(tricky.title, "t", "title falls back to id");
equal(
  parseRuleset(
    "---\nid: b\npaths: src/**/*.{ts,tsx}, **/*.css\n---\n## b/one\nRule: r\nViolated when: v\nFollowed when: f\n",
    "braces.md",
  ).paths,
  ["src/**/*.{ts,tsx}", "**/*.css"],
  "a comma inside braces does not split the path list",
);

for (const [text, label] of [
  ["## x\nRule: r\n", "missing frontmatter"],
  ["---\ntitle: x\n---\n## x\nRule: r\nViolated when: v\nFollowed when: f\n", 'needs an "id:" line'],
  ["---\nid: x\n---\n## x/a\nRule: r\nViolated when: v\n", 'needs a "followed when:" line'],
  ["---\nid: x\n---\nno rules here\n", 'no "## rule-id" sections'],
]) {
  let message = "";
  try {
    parseRuleset(text, "bad.md");
  } catch (error) {
    message = (error as Error).message;
  }
  if (!message.includes(label)) throw new Error(`expected "${label}", got "${message}"`);
}

const examples = new URL("../examples", import.meta.url).pathname;
const loaded = await loadRulesets(["/nonexistent-rules-dir", examples]);
equal(loaded.rulesets.map((ruleset) => ruleset.id), ["ui"], "loads a directory, skips a missing one");
equal(loaded.errors, [], "no load errors");

console.log("rules.check ok");
