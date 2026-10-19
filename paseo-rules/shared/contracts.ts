import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// Ordered from best to worst. A rule or ruleset shows the worst verdict among its parts.
export const VERDICTS = ["not_applicable", "followed", "not_judged", "unsure", "violated"] as const;
const verdictSchema = z.enum(VERDICTS);

const findingSchema = z.object({
  id: z.string(),
  verdict: z.enum(["unsure", "violated"]),
  /** Probability that the rule is violated here. */
  probability: z.number(),
  file: z.string(),
  /** Ranges of added lines in the checked part of the file. */
  lines: z.array(z.tuple([z.number(), z.number()])),
});

const ruleResultSchema = z.object({
  id: z.string(),
  rule: z.string(),
  severity: z.string(),
  verdict: verdictSchema,
  findings: z.array(findingSchema),
});

const rulesetResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  file: z.string(),
  verdict: verdictSchema,
  rules: z.array(ruleResultSchema),
});

export const reviewSchema = z.object({
  status: z.enum(["running", "done", "error"]),
  /** Why there are no verdicts, or what went wrong. */
  message: z.string().nullable(),
  finishedAt: z.string().nullable(),
  files: z.number(),
  skippedFiles: z.number(),
  rulesets: z.array(rulesetResultSchema),
  /** Rule files that failed to parse. */
  ruleErrors: z.array(z.string()),
  /** What the check did, one line per step. Grows while the check runs. */
  log: z.array(z.string()),
});

export type Verdict = z.infer<typeof verdictSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type RuleResult = z.infer<typeof ruleResultSchema>;
export type RulesetResult = z.infer<typeof rulesetResultSchema>;
export type Review = z.infer<typeof reviewSchema>;

export const getReview = defineRpc({
  name: "rules.review.get",
  input: z.object({ agentId: z.string() }),
  output: z.object({ review: reviewSchema.nullable() }),
});

export const runReview = defineRpc({
  name: "rules.review.run",
  input: z.object({ agentId: z.string() }),
  output: z.object({}),
});

export const sendFeedback = defineRpc({
  name: "rules.feedback.send",
  input: z.object({ agentId: z.string(), findingIds: z.array(z.string()).min(1) }),
  output: z.object({ sent: z.number() }),
});

export const judgeSettings = defineSettings({
  id: "judge",
  scope: "host",
  version: 1,
  schema: z.object({
    judgeUrl: z.string().default("https://openrouter.ai/api/alpha/decisions"),
    model: z.string().default("typesafe/jev-1.13"),
    apiKey: z.string().default(""),
    globalRulesDir: z.string().default("~/.config/paseo-rules"),
    autoCheck: z.boolean().default(true),
  }),
});
