import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Reviews are read from `<workspace>/.paseo/reviews/*.json`. */
export const REVIEW_DIR = ".paseo/reviews";

/** Panel-owned state lives next to the review as `<name>.state.json`, so the agent never races the panel. */
export const STATE_SUFFIX = ".state.json";

export const SEVERITIES = ["blocking", "should-fix", "nit"] as const;
export type Severity = (typeof SEVERITIES)[number];

const SEVERITY_ALIASES: Record<string, Severity> = {
  blocker: "blocking",
  critical: "blocking",
  "must-fix": "blocking",
  shouldfix: "should-fix",
  major: "should-fix",
  nitpick: "nit",
  nits: "nit",
  minor: "nit",
};

function normalizeSeverity(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return SEVERITY_ALIASES[key] ?? key;
}

export const VERDICTS = ["approve", "changes-requested", "comment"] as const;
export type Verdict = (typeof VERDICTS)[number];

function normalizeVerdict(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** Accepts `42` and `"42"`; agents write both. */
const positiveInt = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value),
  z.number().int().positive(),
);

/** A git revision. Plain characters only and no leading dash, so git can never read it as an option. */
export const gitRefSchema = z
  .string()
  .trim()
  .regex(/^(?!-)[A-Za-z0-9._/@^~{}-]{1,200}$/, "must be a commit SHA, branch, or tag");

export const findingLocationSchema = z.object({
  /** Path relative to the workspace directory. */
  file: z.string().trim().min(1),
  /** First line of the range. Counts in the head version of the file, or the base version when `side` is "old". */
  line: positiveInt,
  /** Last line of the range, inclusive. */
  endLine: positiveInt.nullish(),
  /** "new" (default): head line numbers. "old": base line numbers, for code the change removed. */
  side: z.enum(["new", "old"]).default("new"),
  /** Short label for the location chip, e.g. "loop condition". */
  note: z.string().nullish(),
});
export type FindingLocation = z.infer<typeof findingLocationSchema>;

export const resolutionSchema = z.object({
  status: z.enum(["fixed", "wont-fix"]),
  note: z.string().nullish(),
  at: z.string().nullish(),
});

export const findingSchema = z.object({
  /** Stable id such as B1, S2, N3. Kept across rewrites of the review file. */
  id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,24}$/, "must be a short id such as B1"),
  severity: z.preprocess(normalizeSeverity, z.enum(SEVERITIES)),
  title: z.string().trim().min(1),
  /** What a user of the app notices, in plain language. */
  symptom: z.string().nullish(),
  /** The code cause. May reference other code as `path:line`. */
  detail: z.string().trim().min(1),
  /** Suggested fix. */
  fix: z.string().nullish(),
  locations: z.array(findingLocationSchema).default([]),
  /** Set by the agent after it handled the finding. */
  resolution: resolutionSchema.nullish(),
});
export type Finding = z.infer<typeof findingSchema>;

export const reviewScopeSchema = z.object({
  /** Commit the reviewed diff starts from, ideally the merge-base SHA. */
  base: gitRefSchema,
  baseLabel: z.string().nullish(),
  /** Commit the diff ends at; null or absent means the working tree. */
  head: gitRefSchema.nullish(),
  headLabel: z.string().nullish(),
});
export type ReviewScope = z.infer<typeof reviewScopeSchema>;

const reviewFields = {
  version: z.literal(1).optional(),
  title: z.string().trim().min(1),
  createdAt: z.string().nullish(),
  reviewer: z.string().nullish(),
  verdict: z.preprocess(normalizeVerdict, z.enum(VERDICTS)).nullish(),
  summary: z.string().nullish(),
  scope: reviewScopeSchema,
};

/** Top level of a review file. Findings are validated one by one, so one bad finding does not hide the rest. */
export const reviewEnvelopeSchema = z.object({ ...reviewFields, findings: z.array(z.unknown()) });

export const reviewSchema = z.object({ ...reviewFields, findings: z.array(findingSchema) });
export type Review = z.infer<typeof reviewSchema>;

export const findingStateSchema = z.object({
  sentAt: z.string().nullish(),
  dismissed: z.boolean().optional(),
});
export type FindingState = z.infer<typeof findingStateSchema>;

export const reviewStateSchema = z.object({
  findings: z.record(z.string(), findingStateSchema).default({}),
});
export type ReviewState = z.infer<typeof reviewStateSchema>;

const severityCountsSchema = z.object({
  blocking: z.number(),
  "should-fix": z.number(),
  nit: z.number(),
});
export type SeverityCounts = z.infer<typeof severityCountsSchema>;

export const reviewSummarySchema = z.object({
  /** File name inside the reviews directory, e.g. `upload-retry.json`. */
  name: z.string(),
  title: z.string(),
  modifiedAt: z.number(),
  counts: severityCountsSchema,
  /** Findings without a resolution from the agent. */
  open: z.number(),
  valid: z.boolean(),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export const diffLineSchema = z.object({
  kind: z.enum(["context", "add", "del"]),
  oldLine: z.number().nullable(),
  newLine: z.number().nullable(),
  text: z.string(),
  /** Syntax-highlighted runs that concatenate to `text`; style names come from @getpaseo/highlight. */
  tokens: z.array(z.object({ text: z.string(), style: z.string().nullable() })).optional(),
});
export type DiffLine = z.infer<typeof diffLineSchema>;

export const diffHunkSchema = z.object({
  /** Function context git prints after the range, if any. */
  section: z.string(),
  oldStart: z.number(),
  newStart: z.number(),
  lines: z.array(diffLineSchema),
});
export type DiffHunk = z.infer<typeof diffHunkSchema>;

export const fileDiffSchema = z.object({
  /** "unchanged": the file is not part of the diff; hunks hold the whole file as context. */
  status: z.enum(["modified", "added", "deleted", "unchanged", "binary", "missing"]),
  hunks: z.array(diffHunkSchema),
  truncated: z.boolean(),
});
export type FileDiff = z.infer<typeof fileDiffSchema>;

/** Context lines around each change in the diff view. */
export const DEFAULT_CONTEXT = 5;
export const MORE_CONTEXT = 25;
/** Large enough that git prints the whole file as one hunk. */
export const WHOLE_FILE_CONTEXT = 100_000;

const directory = z.string().min(1);
export const REVIEW_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;
const reviewName = z
  .string()
  .regex(REVIEW_NAME_PATTERN)
  .refine((name) => !name.endsWith(STATE_SUFFIX), "must be a review file, not a state file");

export const listReviewsRpc = defineRpc({
  name: "reviews.list",
  input: z.object({ directory }),
  output: z.object({ reviews: z.array(reviewSummarySchema), reviewsDir: z.string() }),
});

export const readReviewRpc = defineRpc({
  name: "reviews.read",
  input: z.object({ directory, name: reviewName }),
  output: z.object({
    review: reviewSchema.nullable(),
    /** Validation problems, one line each. Non-empty with a review means some findings were skipped. */
    problems: z.array(z.string()),
    modifiedAt: z.number(),
  }),
});

export const readStateRpc = defineRpc({
  name: "reviews.state.read",
  input: z.object({ directory, name: reviewName }),
  output: z.object({ state: reviewStateSchema }),
});

export const writeStateRpc = defineRpc({
  name: "reviews.state.write",
  input: z.object({ directory, name: reviewName, state: reviewStateSchema }),
  output: z.object({ ok: z.literal(true) }),
});

export const fileDiffRpc = defineRpc({
  name: "reviews.diff",
  input: z.object({
    directory,
    base: gitRefSchema,
    head: gitRefSchema.nullable(),
    file: z.string().min(1),
    context: z.number().int().min(0).max(WHOLE_FILE_CONTEXT),
  }),
  output: fileDiffSchema,
});
