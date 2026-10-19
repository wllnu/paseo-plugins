// Run: node --experimental-strip-types server/review.check.ts
// Builds a throwaway git repository and reviews it with a canned judge. Needs no key.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgetBase, rememberBase, splitDiff } from "./diff.ts";
import type { Judge } from "./judge.ts";
import { feedbackMessage, latestReview, review, rulesIndex, startReview } from "./review.ts";

function equal(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const repo = mkdtempSync(join(tmpdir(), "paseo-rules-"));
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const write = (file: string, text: string) => writeFileSync(join(repo, file), text);
const card = (color: string) =>
  `export function Card() {\n  return (\n    <Text style={{ color: ${color} }}>Saved</Text>\n  );\n}\n`;

try {
  git("init", "-q");
  git("config", "user.email", "check@example.com");
  git("config", "user.name", "check");
  mkdirSync(join(repo, ".rules"));
  mkdirSync(join(repo, "src"));
  copyFileSync(new URL("../examples/ui.md", import.meta.url).pathname, join(repo, ".rules/ui.md"));
  write("src/Card.tsx", card("theme.colors.foreground"));
  write("src/db.ts", "export const db = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "base");

  await rememberBase(repo, "agent-1");
  await rememberBase(repo, "agent-1"); // a second call keeps the first base

  // The agent commits a change, leaves another uncommitted, adds a file, and touches a lockfile.
  write("src/Card.tsx", card('"#fff"'));
  git("commit", "-qam", "agent commit");
  write("src/db.ts", "export const db = 2;\n");
  write("src/New.tsx", "export const New = () => <Text>New</Text>;\n");
  write("src/math.tsx", 'export const white = "#fff".length;\n');
  write("package-lock.json", "{}\n");

  let calls = 0;
  // Step one: the UI ruleset covers every diff except math.tsx, which is not a UI change.
  // Step two: rule 0 is violated wherever "#fff" appears, rule 1 is a coin toss, rule 2 never applies.
  const judge: Judge = async (state, questions) => {
    calls += 1;
    if ("s0" in questions) {
      const no = String(state.file).endsWith("math.tsx") ? 0.9 : 0.1;
      return { s0: { choice: no > 0.5 ? "does_not_apply" : "applies", probabilities: { applies: 1 - no, does_not_apply: no } } };
    }
    const hex = String(state.diff).includes("#fff");
    return Object.fromEntries(
      Object.keys(questions).map((id, index) => [
        id,
        index === 0
          ? hex
            ? { choice: "violated", probabilities: { violated: 0.9, followed: 0.05, not_applicable: 0.05 } }
            : { choice: "followed", probabilities: { violated: 0.1, followed: 0.8, not_applicable: 0.1 } }
          : index === 1
            ? { choice: "not_applicable", probabilities: { violated: 0.2, followed: 0.3, not_applicable: 0.5 } }
            : { choice: "not_applicable", probabilities: { violated: 0, followed: 0.05, not_applicable: 0.95 } },
      ]),
    );
  };
  const input = { cwd: repo, agentId: "agent-1", globalRulesDir: join(repo, "no-global"), judge, model: "m" };

  const first = await review(input);
  equal(first.status, "done", "status");
  equal(first.message, null, "no message when judged");
  equal(first.files, 4, "Card.tsx, db.ts, New.tsx and math.tsx changed, the lockfile is skipped");
  equal(calls, 5, "three scope calls for the tsx files, two rule calls, none for math.tsx or db.ts");
  for (const part of ["Loaded 1 rulesets: UI rules", "src/math.tsx: UI rules skipped, 10% in scope (judge call)", "src/Card.tsx: UI rules checked, 1 broken, 1 unsure, 0 followed (judge call)", "src/db.ts: no ruleset matches this path"]) {
    if (!first.log.some((line) => line.endsWith(part))) throw new Error(`log is missing "${part}":\n${first.log.join("\n")}`);
  }
  const [ui] = first.rulesets;
  equal(ui.file, ".rules/ui.md", "ruleset path is relative to the repository");
  equal(ui.verdict, "violated", "ruleset shows its worst rule");
  equal(ui.rules.map((rule) => rule.verdict), ["violated", "unsure", "not_applicable"], "rule verdicts");
  equal(
    ui.rules[0].findings.map(({ file, lines, verdict }) => ({ file, lines, verdict })),
    [{ file: "src/Card.tsx", lines: [[3, 3]], verdict: "violated" }],
    "the committed change is found at its added line",
  );
  equal(ui.rules[1].findings.map((finding) => finding.file), ["src/Card.tsx", "src/New.tsx"], "unsure findings");
  equal(ui.rules[1].findings[1].lines, [[1, 1]], "an untracked file is all added lines");

  await review(input);
  equal(calls, 5, "an unchanged diff is answered from the cache");

  const message = feedbackMessage(first, [ui.rules[0].findings[0].id]);
  equal(message.count, 1, "one rule in the feedback");
  for (const part of ["ui/theme-colors (UI rules, .rules/ui.md)", "Where: src/Card.tsx line 3", "Take every color"]) {
    if (!message.text.includes(part)) throw new Error(`feedback is missing "${part}":\n${message.text}`);
  }

  write("src/Card.tsx", card("theme.colors.foreground"));
  const fixed = await review(input);
  equal(calls, 5, "a file back at its base state has no diff to judge");
  equal(fixed.files, 3, "the fixed file drops out of the change");
  equal(fixed.rulesets[0].rules[0].verdict, "followed", "the fix clears the violation");

  const unjudged = await review({ ...input, judge: null });
  equal(unjudged.rulesets[0].verdict, "not_judged", "no judge means no verdict");

  const unscoped = await review({ ...input, model: "unsure", judge: async (_, questions) =>
    Object.fromEntries(Object.keys(questions).map((id) => [id, { choice: "does_not_apply", probabilities: { applies: 0.45, does_not_apply: 0.55, violated: 1 } }])) });
  equal(unscoped.rulesets[0].rules[0].findings.length, 2, "an unsure scope answer still checks the rules");
  if (!unjudged.message?.includes("No judge key")) throw new Error("expected the missing key message");

  const index = await rulesIndex(repo, join(repo, "no-global"));
  if (!index?.includes("- UI rules (.rules/ui.md). Files: **/*.tsx, **/*.css. The change adds")) {
    throw new Error(`unexpected rules index:\n${index}`);
  }
  equal(await rulesIndex(tmpdir(), join(repo, "no-global")), null, "no rulesets means no index");

  const outside = await review({ ...input, cwd: tmpdir() });
  equal(outside.message, "This agent's directory is not a git repository.", "outside a repository");

  // A failing judge ends in an error review, and a turn that ends meanwhile triggers a second run.
  let runs = 0;
  const failing = async () => {
    runs += 1;
    return { ...input, agentId: "agent-2", judge: (async () => Promise.reject(new Error("Judge returned 401."))) as Judge, model: "other" };
  };
  startReview("agent-2", failing);
  startReview("agent-2", failing);
  equal(latestReview("agent-2")?.status, "running", "running while in progress");
  while (latestReview("agent-2")?.status === "running") await new Promise((resolve) => setTimeout(resolve, 20));
  equal(latestReview("agent-2")?.status, "error", "error status");
  equal(latestReview("agent-2")?.message, "Judge returned 401.", "error message");
  equal(latestReview("agent-2")?.log.at(-1), "Failed: Judge returned 401.", "the log ends with the failure");
  equal(runs, 2, "a second request during a review runs it once more");

  const hunk = (start: number) => `@@ -${start},2 +${start},3 @@\n context\n+${"x".repeat(20_000)}\n context\n`;
  const parts = splitDiff("big.ts", `diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n${hunk(1)}${hunk(50)}${hunk(90)}`);
  equal(parts.map((unit) => unit.lines), [[[2, 2]], [[51, 51]], [[91, 91]]], "a large diff splits at hunk boundaries");
  equal(parts.every((unit) => unit.diff.startsWith("diff --git")), true, "every part keeps the file header");
  equal(splitDiff("bin.png", "diff --git a/bin.png b/bin.png\nBinary files differ\n"), [], "a binary file has no units");

  await forgetBase(repo, "agent-1");
  equal(existsSync(join(repo, ".git/paseo-rules/agent-1.base")), false, "the base file is removed");
  const afterForget = await review(input);
  equal(afterForget.files, 4, "without a base only uncommitted changes are compared");

  console.log("review.check ok");
} finally {
  rmSync(repo, { recursive: true, force: true });
}
