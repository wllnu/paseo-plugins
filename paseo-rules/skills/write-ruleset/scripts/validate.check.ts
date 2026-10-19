// Run: node --experimental-strip-types skills/write-ruleset/scripts/validate.check.ts
// Runs the validator the way an agent does, on the plugin's example ruleset and on broken ones.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./validate.ts", import.meta.url));
const validate = (dir: string) => {
  const run = spawnSync("node", ["--experimental-strip-types", "--no-warnings", script, dir], {
    encoding: "utf8",
  });
  return { status: run.status, output: run.stdout + run.stderr };
};
function expect(output: string, part: string) {
  if (!output.includes(part)) throw new Error(`expected "${part}" in:\n${output}`);
}

const good = validate(fileURLToPath(new URL("../../../examples", import.meta.url)));
if (good.status !== 0) throw new Error(`the example ruleset should pass:\n${good.output}`);
expect(good.output, "ui.md: 3 rules");
expect(good.output, "examples.check.ts");

const rule = (id: string, extra: string) =>
  `## ${id}\nRule: r\nViolated when: the code is not clean.\nFollowed when: f\n${extra}\n`;
const fence = (label: string, code: string) => `${label}:\n\`\`\`ts\n${code}\n\`\`\`\n`;
const dir = mkdtempSync(join(tmpdir(), "write-ruleset-"));
try {
  writeFileSync(
    join(dir, "api.md"),
    `---\nid: api\npaths: !src/**\n---\n${rule("api/one", fence("Good", "a") + fence("Bad", "a"))}${rule("other/Two", "Severity: fatal")}${rule("api/one", fence("Good", "a") + fence("Bad", "b"))}`,
  );
  writeFileSync(join(dir, "copy.md"), `---\nid: api\nwhen: w\n---\n${rule("api/x", fence("Good", "a") + fence("Bad", "b"))}`);
  writeFileSync(join(dir, "notes.md"), "Just some notes.\n");

  const bad = validate(dir);
  if (bad.status !== 1) throw new Error(`broken rulesets should fail with 1, got ${bad.status}:\n${bad.output}`);
  for (const part of [
    "notes.md: missing frontmatter",
    'api.md: "paths" does not support negation',
    "api.md: api/one: Good and Bad examples are identical",
    "api.md: other/Two: name the rule api/<kebab-case-name>",
    'api.md: other/Two: Severity must be error or warning, got "fatal"',
    'api.md: other/Two: needs a "Good:" line',
    "api.md: api/one: duplicate rule id",
    'copy.md: id "api" is already used by api.md',
    "copy.md: name the file api.md",
    'api.md: no "when:" line',
    'api.md: no "title:" line',
    '"Violated when" says "clean"',
  ]) {
    expect(bad.output, part);
  }

  const empty = validate(join(dir, "missing"));
  if (empty.status !== 1) throw new Error("a missing directory should fail");
  expect(empty.output, "no .md files found");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("validate.check ok");
