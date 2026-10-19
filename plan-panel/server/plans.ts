import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  PLAN_DIR,
  PLAN_FILE,
  planCommentSchema,
  type PlanComment,
  type listPlansRpc,
  type readCommentsRpc,
  type readPlanRpc,
  type writeCommentsRpc,
} from "../shared/contracts";

function plansDirectory(directory: string): string {
  if (!path.isAbsolute(directory)) {
    throw new Error("Workspace directory must be an absolute path.");
  }
  return path.join(directory, PLAN_DIR);
}

function planPath(directory: string, name: string): string {
  const dir = plansDirectory(directory);
  const resolved = path.resolve(dir, name);
  if (path.dirname(resolved) !== path.resolve(dir)) {
    throw new Error("Plan name must not contain path segments.");
  }
  return resolved;
}

function commentsPath(directory: string, name: string): string {
  return planPath(directory, name).replace(/\.(?:html|md)$/, ".comments.json");
}

function extractTitle(name: string, text: string): string | null {
  if (name.endsWith(".md")) return /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || null;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text)?.[1];
  const raw = (title && title.trim()) || (h1 && h1.trim()) || null;
  if (!raw) return null;
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function listPlans({ directory }: RpcInput<typeof listPlansRpc>): Promise<RpcOutput<typeof listPlansRpc>> {
  const dir = plansDirectory(directory);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { plans: [], plansDir: dir };
    throw error;
  }
  const plans = await Promise.all(
    entries
      .filter((entry) => PLAN_FILE.test(entry))
      .map(async (name) => {
        const file = path.join(dir, name);
        const stat = await fs.stat(file);
        if (!stat.isFile()) return null;
        let title: string | null = null;
        try {
          title = extractTitle(name, await fs.readFile(file, "utf8"));
        } catch {
          title = null;
        }
        return { name, title: title ?? name.replace(/\.(?:html|md)$/, ""), modifiedAt: stat.mtimeMs };
      }),
  );
  const sorted = plans
    .filter((plan): plan is NonNullable<typeof plan> => plan !== null)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  return { plans: sorted, plansDir: dir };
}

export async function readPlan({ directory, name }: RpcInput<typeof readPlanRpc>): Promise<RpcOutput<typeof readPlanRpc>> {
  const file = planPath(directory, name);
  const [text, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
  return { text, modifiedAt: stat.mtimeMs };
}

export async function readComments({
  directory,
  name,
}: RpcInput<typeof readCommentsRpc>): Promise<RpcOutput<typeof readCommentsRpc>> {
  const file = commentsPath(directory, name);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { comments: [] };
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as { comments?: unknown };
    const list = Array.isArray(parsed.comments) ? parsed.comments : [];
    const comments: PlanComment[] = [];
    for (const entry of list) {
      const result = planCommentSchema.safeParse(entry);
      if (result.success) comments.push(result.data);
    }
    return { comments };
  } catch (error) {
    console.error(`plan-panel: could not parse ${file}:`, error);
    return { comments: [] };
  }
}

export async function writeComments({
  directory,
  name,
  comments,
}: RpcInput<typeof writeCommentsRpc>): Promise<RpcOutput<typeof writeCommentsRpc>> {
  const file = commentsPath(directory, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const payload = JSON.stringify({ version: 1, plan: name, comments }, null, 2);
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, payload, "utf8");
  await fs.rename(temp, file);
  return { ok: true };
}
