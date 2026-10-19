// Run: PASEO_RULES_JUDGE_KEY=... node --experimental-strip-types server/examples.check.ts <rules-dir>
// Sends every rule's Bad example expecting "violated" and its Good example expecting "followed".
// A rule that fails its own examples is too vague for the judge. This calls the real judge.
// Optional: PASEO_RULES_JUDGE_URL and PASEO_RULES_JUDGE_MODEL override the defaults.
import { httpJudge } from "./judge.ts";
import { decide, questions } from "./review.ts";
import { loadRulesets } from "./rules.ts";

const dir = process.argv[2];
const apiKey = process.env.PASEO_RULES_JUDGE_KEY;
if (!dir || !apiKey) {
  console.error("Usage: PASEO_RULES_JUDGE_KEY=... node --experimental-strip-types server/examples.check.ts <rules-dir>");
  process.exit(2);
}

const judge = httpJudge({
  url: process.env.PASEO_RULES_JUDGE_URL ?? "https://openrouter.ai/api/alpha/decisions",
  model: process.env.PASEO_RULES_JUDGE_MODEL ?? "typesafe/jev-1.13",
  apiKey,
});

// The judge sees an example the way it sees real input: as added lines of a diff.
function asDiff(example: string) {
  const lines = example.split("\n");
  return `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n`;
}

const { rulesets, errors } = await loadRulesets([dir]);
for (const error of errors) console.error(error);
let failed = errors.length;

for (const ruleset of rulesets) {
  // All of a ruleset's questions go in one call, as in a real check, so this measures the same thing.
  const asked = questions(ruleset);
  for (const [index, rule] of ruleset.rules.entries()) {
    for (const [example, expected] of [
      [rule.bad, "violated"],
      [rule.good, "followed"],
    ]) {
      if (!example) {
        console.log(`skip\t${rule.id}\tno ${expected === "violated" ? "Bad" : "Good"} example`);
        continue;
      }
      const answers = await judge({ file: "example", diff: asDiff(example) }, asked);
      const { verdict, probability } = decide(answers[`r${index}`]);
      const pass = verdict === expected;
      if (!pass) failed += 1;
      console.log(
        `${pass ? "pass" : "FAIL"}\t${rule.id}\texpected ${expected}, got ${verdict} (${Math.round(probability * 100)}% violated)`,
      );
    }
  }
}

console.log(failed ? `${failed} failed` : "examples.check ok");
process.exit(failed ? 1 : 0);
