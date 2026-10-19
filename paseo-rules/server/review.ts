import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { type Review, VERDICTS, type Verdict } from "../shared/contracts.ts";
import { type Unit, changedFiles, fileUnits, readBase, repoRoot } from "./diff.ts";
import type { Answer, Judge, Question } from "./judge.ts";
import { type Ruleset, appliesTo, expandHome, loadRulesets } from "./rules.ts";

export interface ReviewInput {
  cwd: string;
  agentId: string;
  globalRulesDir: string;
  /** Null when no key is set. Matching rules are then listed without a verdict. */
  judge: Judge | null;
  model: string;
  /** Receives one line per step. startReview shares it with the running review, so the panel sees it grow. */
  log?: string[];
}

// lazy: one fixed threshold for every rule. Upgrade path: tune it, or set it per rule, from the
// pass rates that examples.check.ts prints.
const THRESHOLD = 0.6;
const EMPTY: Review = {
  status: "done",
  message: null,
  finishedAt: null,
  files: 0,
  skippedFiles: 0,
  rulesets: [],
  ruleErrors: [],
  log: [],
};

type Log = (line: string) => void;
const percent = (value: number) => `${Math.round(value * 100)}%`;

function worst(verdicts: Verdict[]) {
  return verdicts.reduce<Verdict>(
    (a, b) => (VERDICTS.indexOf(b) > VERDICTS.indexOf(a) ? b : a),
    "not_applicable",
  );
}

function rulesDirs(root: string | null, globalRulesDir: string) {
  return [expandHome(globalRulesDir), ...(root ? [join(root, ".rules")] : [])];
}

// Rule files inside the repository are shown relative to it, global ones by absolute path.
function displayPath(root: string, file: string) {
  const path = relative(root, file);
  return path.startsWith("..") ? file : path;
}

// Step one. One question per ruleset: is this diff the kind of change the ruleset covers?
export function scopeQuestions(rulesets: Ruleset[]): Record<string, Question> {
  return Object.fromEntries(
    rulesets.map((ruleset, index) => [
      `s${index}`,
      {
        type: "choice",
        instructions: `Ruleset: ${ruleset.title}. Decide whether this diff is the kind of change the ruleset covers.`,
        criteria: {
          applies: ruleset.when,
          does_not_apply: "The diff is not that kind of change.",
        },
      },
    ]),
  );
}

// Step two. One question per rule. The keys are positions because rule IDs contain slashes.
export function questions(ruleset: Ruleset): Record<string, Question> {
  return Object.fromEntries(
    ruleset.rules.map((rule, index) => [
      `r${index}`,
      {
        type: "choice",
        instructions: `Rule: ${rule.rule} Judge only the lines this diff adds or changes.`,
        criteria: {
          followed: rule.followedWhen,
          violated: rule.violatedWhen,
          not_applicable: "The diff does not touch anything this rule covers.",
        },
      },
    ]),
  );
}

export function decide(answer: Answer | undefined): { verdict: Verdict; probability: number } {
  if (!answer) return { verdict: "not_judged", probability: 0 };
  const probability = answer.probabilities.violated ?? 0;
  if (probability >= THRESHOLD) return { verdict: "violated", probability };
  const confident = (answer.probabilities[answer.choice] ?? 0) >= THRESHOLD;
  if (confident && answer.choice === "followed") return { verdict: "followed", probability };
  if (confident && answer.choice === "not_applicable") return { verdict: "not_applicable", probability };
  return { verdict: "unsure", probability };
}

// lazy: answers are kept for the life of the plugin process and never evicted.
// Upgrade path: an LRU limit, or a file under the git directory to survive reloads.
const cache = new Map<string, Promise<Record<string, Answer>>>();

// An unchanged file with unchanged questions is never judged twice, across turns and across agents.
function ask(judge: Judge, model: string, unit: Unit, asked: Record<string, Question>) {
  const key = createHash("sha256")
    .update(JSON.stringify([model, unit.diff, asked]))
    .digest("hex");
  const cached = cache.get(key);
  const answers = cached ?? judge({ file: unit.file, diff: unit.diff }, asked);
  if (!cached) {
    cache.set(key, answers);
    answers.catch(() => cache.delete(key));
  }
  return answers.then((value) => ({ answers: value, source: cached ? "cached" : "judge call" }));
}

// The rulesets to check a unit against. Path globs narrow the candidates for free, then the judge
// drops the ones whose `when:` line does not describe the diff. A ruleset without a `when:` line
// applies on its paths alone, and so does every candidate when there is no judge.
async function rulesetsFor(judge: Judge | null, model: string, rulesets: Ruleset[], unit: Unit, log: Log) {
  const candidates = rulesets.filter((ruleset) => appliesTo(ruleset, unit.file));
  if (candidates.length === 0) log(`${unit.file}: no ruleset matches this path`);
  const asked = candidates.filter((ruleset) => ruleset.when);
  if (!judge || asked.length === 0) {
    if (candidates.length > 0) {
      log(`${unit.file}: ${candidates.map((ruleset) => ruleset.title).join(", ")} picked by path`);
    }
    return candidates;
  }
  const { answers, source } = await ask(judge, model, unit, scopeQuestions(asked));
  // An unsure judge keeps the ruleset, because a skipped ruleset hides its violations.
  const skipped = asked.filter((ruleset, index) => {
    const no = answers[`s${index}`]?.probabilities.does_not_apply ?? 0;
    const skip = no >= THRESHOLD;
    log(`${unit.file}: ${ruleset.title} ${skip ? "skipped" : "applies"}, ${percent(1 - no)} in scope (${source})`);
    return skip;
  });
  return candidates.filter((ruleset) => !skipped.includes(ruleset));
}

export async function review({ cwd, agentId, globalRulesDir, judge, model, log: lines = [] }: ReviewInput): Promise<Review> {
  const log: Log = (line) => lines.push(`${new Date().toTimeString().slice(0, 8)} ${line}`);
  const root = await repoRoot(cwd);
  const { rulesets, errors } = await loadRulesets(rulesDirs(root, globalRulesDir));
  log(`Loaded ${rulesets.length} rulesets: ${rulesets.map((ruleset) => ruleset.title).join(", ") || "none"}`);
  const done = (rest: Partial<Review>): Review => {
    log(rest.message ?? "Done");
    return { ...EMPTY, finishedAt: new Date().toISOString(), ruleErrors: errors, log: lines, ...rest };
  };
  if (!root) return done({ message: "This agent's directory is not a git repository." });
  if (rulesets.length === 0) {
    return done({ message: `No rulesets found in .rules or ${globalRulesDir}.` });
  }

  const base = await readBase(root, agentId);
  const { files, skipped } = await changedFiles(root, base);
  const units: Unit[] = [];
  for (const { file, untracked } of files) units.push(...(await fileUnits(root, base, file, untracked)));

  log(`${files.length} changed files in ${units.length} parts, ${skipped} not checked, judge ${judge ? model : "off"}`);

  const applied = await Promise.all(units.map((unit) => rulesetsFor(judge, model, rulesets, unit, log)));
  const results = await Promise.all(
    rulesets.map(async (ruleset) => {
      const matched = units.filter((_, index) => applied[index].includes(ruleset));
      const answers = await Promise.all(
        matched.map(async (unit) => {
          if (!judge) return undefined;
          const { answers, source } = await ask(judge, model, unit, questions(ruleset));
          const verdicts = ruleset.rules.map((_, index) => decide(answers[`r${index}`]).verdict);
          const count = (verdict: Verdict) => verdicts.filter((each) => each === verdict).length;
          log(`${unit.file}: ${ruleset.title} checked, ${count("violated")} broken, ${count("unsure")} unsure, ${count("followed")} followed (${source})`);
          return answers;
        }),
      );
      const rules = ruleset.rules.map((rule, index) => {
        const decisions = matched.map((unit, i) => ({ unit, ...decide(answers[i]?.[`r${index}`]) }));
        return {
          id: rule.id,
          rule: rule.rule,
          severity: rule.severity,
          verdict: worst(decisions.map((decision) => decision.verdict)),
          findings: decisions.flatMap(({ unit, verdict, probability }) =>
            verdict === "violated" || verdict === "unsure"
              ? [
                  {
                    id: `${ruleset.id}|${rule.id}|${unit.file}|${unit.part}`,
                    verdict,
                    probability,
                    file: unit.file,
                    lines: unit.lines,
                  },
                ]
              : [],
          ),
        };
      });
      return {
        id: ruleset.id,
        title: ruleset.title,
        file: displayPath(root, ruleset.file),
        verdict: worst(rules.map((rule) => rule.verdict)),
        rules,
      };
    }),
  );

  return done({
    message: judge ? null : "No judge key is set, so matching rules are listed without a verdict.",
    files: files.length,
    skippedFiles: skipped,
    rulesets: results,
  });
}

const reviews = new Map<string, Review>();
// Agents with a review in progress. True means a turn ended meanwhile and the review must run again.
const active = new Map<string, boolean>();

export function latestReview(agentId: string) {
  return reviews.get(agentId) ?? null;
}

export function forgetReview(agentId: string) {
  reviews.delete(agentId);
}

// lazy: reviews live in memory, so a plugin reload loses them and "Check now" rebuilds them.
// Upgrade path: write each review next to the base file in the git directory.
export function startReview(agentId: string, input: () => Promise<ReviewInput>) {
  if (active.has(agentId)) {
    active.set(agentId, true);
    return;
  }
  active.set(agentId, false);
  void (async () => {
    do {
      active.set(agentId, false);
      // The previous result stays visible while the new one is computed.
      const log: string[] = [];
      reviews.set(agentId, { ...(reviews.get(agentId) ?? EMPTY), status: "running", log });
      const result = await input()
        .then((values) => review({ ...values, log }))
        .catch((error): Review => {
          const message = error instanceof Error ? error.message : String(error);
          log.push(`Failed: ${message}`);
          return { ...EMPTY, status: "error", message, finishedAt: new Date().toISOString(), log };
        });
      reviews.set(agentId, result);
      // One line per check in `paseo plugin logs`, so a check can be confirmed without the panel.
      const broken = result.rulesets
        .flatMap((ruleset) => ruleset.rules)
        .filter((rule) => rule.verdict === "violated").length;
      console.log(
        `Rules check for ${agentId}: ${result.status}, ${result.files} files, ${result.rulesets.length} rulesets, ${broken} broken. ${result.message ?? ""}`,
      );
    } while (active.get(agentId));
    active.delete(agentId);
  })();
}

// The text added to a new agent's system prompt, or null when the directory has no rulesets.
export async function rulesIndex(cwd: string, globalRulesDir: string) {
  const root = await repoRoot(cwd);
  const { rulesets } = await loadRulesets(rulesDirs(root, globalRulesDir));
  if (rulesets.length === 0) return null;
  return [
    "This project has coding rules. Before you edit a file, read each ruleset below whose scope matches, and follow it. Your changes are checked against these rules after every turn.",
    ...rulesets.map((ruleset) => {
      const files = ruleset.paths.length ? ruleset.paths.join(", ") : "any";
      const path = root ? displayPath(root, ruleset.file) : ruleset.file;
      return `- ${ruleset.title} (${path}). Files: ${files}. ${ruleset.when}`.trimEnd();
    }),
  ].join("\n");
}

function formatLines(lines: Array<[number, number]>) {
  if (lines.length === 0) return "";
  const ranges = lines.map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`));
  return ` ${lines.length === 1 && lines[0][0] === lines[0][1] ? "line" : "lines"} ${ranges.join(", ")}`;
}

// The message sent to the coding agent for the findings the user ticked.
export function feedbackMessage(result: Review, findingIds: string[]) {
  const wanted = new Set(findingIds);
  const items = result.rulesets.flatMap((ruleset) =>
    ruleset.rules.flatMap((rule) => {
      const where = rule.findings.filter((finding) => wanted.has(finding.id));
      if (where.length === 0) return [];
      return [
        [
          `${rule.id} (${ruleset.title}, ${ruleset.file})`,
          `   Rule: ${rule.rule}`,
          ...where.map((finding) => `   Where: ${finding.file}${formatLines(finding.lines)}`),
        ].join("\n"),
      ];
    }),
  );
  const count = items.length;
  const text = [
    `A rules check found ${count} broken ${count === 1 ? "rule" : "rules"} in your changes. Fix each one. If you think a finding is wrong, say so and leave that code as it is.`,
    ...items.map((item, index) => `${index + 1}. ${item}`),
  ].join("\n\n");
  return { text, count };
}
