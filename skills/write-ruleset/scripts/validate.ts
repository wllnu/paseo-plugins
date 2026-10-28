// Run: node --experimental-strip-types scripts/validate.ts <rules-dir>
// Parses every ruleset in the directory with the plugin's own parser, then lints what it accepts.
// Exits with 1 on errors. Warnings do not fail the run.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Ruleset, parseRuleset } from "../../../paseo-rules/server/rules.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node --experimental-strip-types scripts/validate.ts <rules-dir>");
  process.exit(2);
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Words that ask the judge for an opinion instead of pointing at something in the diff.
const VAGUE = /\b(clean|readable|appropriate|appropriately|proper|properly|correctly|reasonable|sensible|nice)\b/i;
// Every rule in a ruleset is asked about every matching file in one call.
const MAX_RULES = 15;

const errors: string[] = [];
const warnings: string[] = [];
const owners = new Map<string, string>();

const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".md")).sort();
if (names.length === 0) errors.push(`${dir}: no .md files found`);

for (const name of names) {
  let ruleset: Ruleset;
  try {
    ruleset = parseRuleset(await readFile(join(dir, name), "utf8"), name);
  } catch (error) {
    errors.push((error as Error).message);
    continue;
  }
  const { id, rules } = ruleset;
  if (!SLUG.test(id)) errors.push(`${name}: id "${id}" must be kebab-case`);
  if (owners.has(id)) errors.push(`${name}: id "${id}" is already used by ${owners.get(id)}`);
  owners.set(id, name);
  if (name !== `${id}.md`) warnings.push(`${name}: name the file ${id}.md to match its id`);
  if (ruleset.title === id) warnings.push(`${name}: no "title:" line, so the panel shows the bare id`);
  if (!ruleset.when) warnings.push(`${name}: no "when:" line, so an agent cannot tell when to read it`);
  if (ruleset.paths.some((path) => path.startsWith("!"))) {
    errors.push(`${name}: "paths" does not support negation with "!"`);
  }
  if (rules.length > MAX_RULES) {
    warnings.push(`${name}: ${rules.length} rules, split it into rulesets of ${MAX_RULES} or fewer`);
  }

  const seen = new Set<string>();
  for (const rule of rules) {
    const at = `${name}: ${rule.id}`;
    if (!rule.id.startsWith(`${id}/`) || !SLUG.test(rule.id.slice(id.length + 1))) {
      errors.push(`${at}: name the rule ${id}/<kebab-case-name>`);
    }
    if (seen.has(rule.id)) errors.push(`${at}: duplicate rule id`);
    seen.add(rule.id);
    if (rule.severity !== "error" && rule.severity !== "warning") {
      errors.push(`${at}: Severity must be error or warning, got "${rule.severity}"`);
    }
    if (!rule.good) errors.push(`${at}: needs a "Good:" line followed by a fenced code block`);
    if (!rule.bad) errors.push(`${at}: needs a "Bad:" line followed by a fenced code block`);
    if (rule.good && rule.good === rule.bad) errors.push(`${at}: Good and Bad examples are identical`);
    for (const [label, text] of [
      ["Violated when", rule.violatedWhen],
      ["Followed when", rule.followedWhen],
    ]) {
      const word = VAGUE.exec(text)?.[0];
      if (word) warnings.push(`${at}: "${label}" says "${word}". Name what the diff shows instead`);
    }
  }
  console.log(`${name}: ${rules.length} ${rules.length === 1 ? "rule" : "rules"}`);
}

for (const warning of warnings) console.log(`warning  ${warning}`);
for (const error of errors) console.error(`error    ${error}`);
if (errors.length) {
  console.error(`${errors.length} ${errors.length === 1 ? "error" : "errors"}. Fix and run again.`);
  process.exit(1);
}
const judge = fileURLToPath(new URL("../../../paseo-rules/server/examples.check.ts", import.meta.url));
console.log("Valid. To test every rule against its own examples with the real judge:");
console.log(`  PASEO_RULES_JUDGE_KEY=... node --experimental-strip-types ${judge} ${dir}`);
