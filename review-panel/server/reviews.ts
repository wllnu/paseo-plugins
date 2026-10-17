import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import {
  REVIEW_DIR,
  REVIEW_NAME_PATTERN,
  STATE_SUFFIX,
  findingSchema,
  reviewEnvelopeSchema,
  reviewStateSchema,
  type Finding,
  type Review,
  type ReviewSummary,
  type listReviewsRpc,
  type readReviewRpc,
  type readStateRpc,
  type writeStateRpc,
} from "../shared/contracts";
import { countSeverities } from "../shared/findings";

function reviewsDirectory(directory: string): string {
  if (!path.isAbsolute(directory)) throw new Error("Workspace directory must be an absolute path.");
  return path.join(directory, REVIEW_DIR);
}

function reviewPath(directory: string, name: string): string {
  const dir = reviewsDirectory(directory);
  const resolved = path.resolve(dir, name);
  if (path.dirname(resolved) !== path.resolve(dir)) throw new Error("Review name must not contain path segments.");
  return resolved;
}

function statePath(directory: string, name: string): string {
  return reviewPath(directory, name).replace(/\.json$/, STATE_SUFFIX);
}

function formatIssues(error: z.ZodError, prefix: string): string[] {
  return error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${prefix}${where}: ${issue.message}`;
  });
}

interface ParsedReview {
  review: Review | null;
  problems: string[];
}

/** Validate the envelope, then each finding on its own, so one malformed finding does not hide the others. */
export function parseReview(raw: string): ParsedReview {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { review: null, problems: [`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const envelope = reviewEnvelopeSchema.safeParse(json);
  if (!envelope.success) return { review: null, problems: formatIssues(envelope.error, "") };

  const problems: string[] = [];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  envelope.data.findings.forEach((entry, index) => {
    const result = findingSchema.safeParse(entry);
    const label = `findings[${index}]`;
    if (!result.success) {
      const id = typeof entry === "object" && entry && "id" in entry ? ` (${String(entry.id)})` : "";
      problems.push(...formatIssues(result.error, `${label}${id}.`));
      return;
    }
    if (seen.has(result.data.id)) {
      problems.push(`${label}: duplicate id ${result.data.id}, skipped`);
      return;
    }
    seen.add(result.data.id);
    findings.push(result.data);
  });
  return { review: { ...envelope.data, findings }, problems };
}

/** Summaries are cached by mtime: the panel polls the list every couple of seconds. */
const summaryCache = new Map<string, { modifiedAt: number; summary: ReviewSummary }>();

async function summarize(file: string, name: string, modifiedAt: number): Promise<ReviewSummary> {
  const cached = summaryCache.get(file);
  if (cached && cached.modifiedAt === modifiedAt) return cached.summary;
  let parsed: ParsedReview;
  try {
    parsed = parseReview(await fs.readFile(file, "utf8"));
  } catch (error) {
    parsed = { review: null, problems: [String(error)] };
  }
  const findings = parsed.review?.findings ?? [];
  const summary: ReviewSummary = {
    name,
    title: parsed.review?.title ?? name.replace(/\.json$/, ""),
    modifiedAt,
    counts: countSeverities(findings),
    open: findings.filter((finding) => !finding.resolution).length,
    valid: parsed.review !== null,
  };
  summaryCache.set(file, { modifiedAt, summary });
  return summary;
}

export async function listReviews({
  directory,
}: RpcInput<typeof listReviewsRpc>): Promise<RpcOutput<typeof listReviewsRpc>> {
  const dir = reviewsDirectory(directory);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { reviews: [], reviewsDir: dir };
    throw error;
  }
  const reviews = await Promise.all(
    entries
      .filter((entry) => REVIEW_NAME_PATTERN.test(entry) && !entry.endsWith(STATE_SUFFIX))
      .map(async (name) => {
        const file = path.join(dir, name);
        const stat = await fs.stat(file).catch(() => null);
        if (!stat?.isFile()) return null;
        return summarize(file, name, stat.mtimeMs);
      }),
  );
  return {
    reviews: reviews
      .filter((review): review is ReviewSummary => review !== null)
      .sort((a, b) => b.modifiedAt - a.modifiedAt),
    reviewsDir: dir,
  };
}

export async function readReview({
  directory,
  name,
}: RpcInput<typeof readReviewRpc>): Promise<RpcOutput<typeof readReviewRpc>> {
  const file = reviewPath(directory, name);
  const [raw, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
  return { ...parseReview(raw), modifiedAt: stat.mtimeMs };
}

export async function readState({
  directory,
  name,
}: RpcInput<typeof readStateRpc>): Promise<RpcOutput<typeof readStateRpc>> {
  const file = statePath(directory, name);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: { findings: {} } };
    throw error;
  }
  try {
    const result = reviewStateSchema.safeParse(JSON.parse(raw));
    if (result.success) return { state: result.data };
    console.error(`review-panel: ignoring invalid state in ${file}`);
  } catch (error) {
    console.error(`review-panel: could not parse ${file}:`, error);
  }
  return { state: { findings: {} } };
}

export async function writeState({
  directory,
  name,
  state,
}: RpcInput<typeof writeStateRpc>): Promise<RpcOutput<typeof writeStateRpc>> {
  const file = statePath(directory, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ version: 1, review: name, ...state }, null, 2), "utf8");
  await fs.rename(temp, file);
  return { ok: true };
}
