import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Rule {
  id: string;
  severity: string;
  rule: string;
  violatedWhen: string;
  followedWhen: string;
  good: string;
  bad: string;
}

export interface Ruleset {
  id: string;
  title: string;
  /** Globs over repo-relative paths. Empty means every file is a candidate. */
  paths: string[];
  when: string;
  file: string;
  /** The raw markdown. Part of the judge cache key, so an edited rule is judged again. */
  text: string;
  rules: Rule[];
}

// The first `Key: value` line wins, so a matching line inside a code example cannot override a field.
function fields(block: string) {
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z][A-Za-z ]*):[ \t]+(\S.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    if (!(key in out)) out[key] = match[2].trim();
  }
  return out;
}

function parseRule(section: string, file: string): Rule {
  const newline = section.indexOf("\n");
  const id = (newline < 0 ? section : section.slice(0, newline)).trim();
  const body = newline < 0 ? "" : section.slice(newline + 1);
  const meta = fields(body);
  for (const key of ["rule", "violated when", "followed when"]) {
    if (!meta[key]) throw new Error(`${file}: rule "${id}" needs a "${key}:" line`);
  }
  const example = (label: string) =>
    new RegExp(`^${label}:[ \\t]*\\n+\`\`\`[^\\n]*\\n([\\s\\S]*?)\\n\`\`\``, "m").exec(body)?.[1] ?? "";
  return {
    id,
    severity: meta.severity ?? "error",
    rule: meta.rule,
    violatedWhen: meta["violated when"],
    followedWhen: meta["followed when"],
    good: example("Good"),
    bad: example("Bad"),
  };
}

// lazy: frontmatter is flat `key: value` lines and `paths` is a comma-separated list.
// Upgrade path: the `yaml` package, once a ruleset needs nested values.
export function parseRuleset(markdown: string, file: string): Ruleset {
  const text = markdown.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const meta = fields(match[1]);
  if (!meta.id) throw new Error(`${file}: frontmatter needs an "id:" line`);
  const rules = match[2]
    .split(/^## +/m)
    .slice(1)
    .map((section) => parseRule(section, file));
  if (rules.length === 0) throw new Error(`${file}: no "## rule-id" sections`);
  return {
    id: meta.id,
    title: meta.title ?? meta.id,
    paths: (meta.paths ?? "")
      // A comma inside {a,b} belongs to the glob and does not end it.
      .split(/,(?![^{]*\})/)
      .map((path) => path.trim())
      .filter(Boolean),
    when: meta.when ?? "",
    file,
    text,
    rules,
  };
}

// Supports **, *, ? and {a,b}. A glob without a slash matches at any depth, like .gitignore.
export function globToRegExp(glob: string) {
  const anchored = glob.includes("/") ? glob : `**/${glob}`;
  const source = anchored
    .replace(/[.+^$()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/|\*\*|\*|\?/g, (token) => {
      if (token === "**/") return "(?:.*/)?";
      if (token === "**") return ".*";
      return token === "*" ? "[^/]*" : "[^/]";
    })
    .replace(/\{([^}]+)\}/g, (_, list: string) => `(?:${list.split(",").join("|")})`);
  return new RegExp(`^${source}$`);
}

export function appliesTo(ruleset: Ruleset, file: string) {
  return ruleset.paths.length === 0 || ruleset.paths.some((glob) => globToRegExp(glob).test(file));
}

export function expandHome(dir: string) {
  return dir === "~" || dir.startsWith("~/") ? join(homedir(), dir.slice(1)) : dir;
}

// Later directories win: a ruleset replaces an earlier one with the same id.
// A file that fails to parse is reported and skipped, so one bad ruleset does not hide the rest.
export async function loadRulesets(dirs: string[]) {
  const byId = new Map<string, Ruleset>();
  const errors: string[] = [];
  for (const dir of dirs) {
    const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".md"));
    for (const name of names.sort()) {
      const file = join(dir, name);
      try {
        const ruleset = parseRuleset(await readFile(file, "utf8"), file);
        byId.set(ruleset.id, ruleset);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return { rulesets: [...byId.values()], errors };
}
