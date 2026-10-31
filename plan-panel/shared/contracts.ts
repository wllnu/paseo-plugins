import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Plans are read from `<workspace>/.paseo/plans/*.html`. */
export const PLAN_DIR = ".paseo/plans";

/** File names the panel lists and opens. */
export const PLAN_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/;

/** One rendered block of the plan: the unit the comment rail selects or a text selection endpoint resolves to. */
const planLocatorBaseSchema = z.object({
  /** Stable key for matching a comment back to a rendered block. */
  key: z.string(),
  /** `id` attribute of the block itself, when present. */
  elementId: z.string().nullable(),
  /** Nearest ancestor-or-self element with an `id`. */
  anchorId: z.string().nullable(),
  /** Heading breadcrumb above the block, outermost first. */
  headings: z.array(z.string()),
  /**
   * HTML tag of the block (p, li, h2, pre, tr, ...), `tag.class` for a component selected as a whole
   * (`ul.facts`, `ol.flow`), or `selection` when no block was found.
   */
  tag: z.string(),
  /** 1-based position of this tag among siblings under the same anchor. */
  ordinal: z.number().int().positive(),
  /** First ~160 characters of the block text. */
  excerpt: z.string(),
});
export type PlanLocatorBase = z.infer<typeof planLocatorBaseSchema>;

/**
 * Where in the plan a comment was left: the first block selected in the comment rail, or the block where a
 * text selection starts.
 */
export const planLocatorSchema = planLocatorBaseSchema.extend({
  /** Exact text the user highlighted, when the comment came from a text selection rather than the rail. */
  selectedText: z.string().nullable().default(null),
  /** Block where a highlighted range ends, when it spans more than one block. */
  end: planLocatorBaseSchema.nullable().default(null),
  /** Further blocks selected in the rail together with this one, in document order. */
  others: z.array(planLocatorBaseSchema).default([]),
});
export type PlanLocator = z.infer<typeof planLocatorSchema>;

export const planCommentSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  text: z.string(),
  /** `null` is a general comment about the whole plan. */
  locator: planLocatorSchema.nullable(),
  /** Plan revision the comment was written against, if the plan declared one. */
  revision: z.string().nullable(),
  status: z.enum(["pending", "sent"]),
  sentAt: z.string().nullable(),
});
export type PlanComment = z.infer<typeof planCommentSchema>;

export const planSummarySchema = z.object({
  /** File name inside the plans directory, e.g. `add-notifications.html`. */
  name: z.string(),
  title: z.string(),
  modifiedAt: z.number(),
});
export type PlanSummary = z.infer<typeof planSummarySchema>;

const directory = z.string().min(1);
const planName = z.string().regex(PLAN_FILE);

export const listPlansRpc = defineRpc({
  name: "plans.list",
  input: z.object({ directory }),
  output: z.object({ plans: z.array(planSummarySchema), plansDir: z.string() }),
});

export const readPlanRpc = defineRpc({
  name: "plans.read",
  input: z.object({ directory, name: planName }),
  /** Raw HTML of the plan. */
  output: z.object({ text: z.string(), modifiedAt: z.number() }),
});

export const readCommentsRpc = defineRpc({
  name: "plans.comments.read",
  input: z.object({ directory, name: planName }),
  output: z.object({ comments: z.array(planCommentSchema) }),
});

export const writeCommentsRpc = defineRpc({
  name: "plans.comments.write",
  input: z.object({ directory, name: planName, comments: z.array(planCommentSchema) }),
  output: z.object({ ok: z.literal(true) }),
});
