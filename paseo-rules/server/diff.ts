import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Unit {
  file: string;
  /** Position of this piece when one file's diff was split. */
  part: number;
  diff: string;
  /** Ranges of added lines in the new file, one per hunk. */
  lines: Array<[number, number]>;
}

// About 12k tokens at 3 characters per token, which leaves room for the questions in a 32k window.
const MAX_UNIT_CHARS = 36_000;
// lazy: a change touching more files than this is checked only for the first ones, and the
// review reports how many it skipped. Upgrade path: a setting, or judging in the background.
const MAX_FILES = 200;
const GENERATED = /(^|\/)(node_modules|dist|build)\/|(\.lock|-lock\.json|-lock\.yaml|\.lockb|\.min\.js|\.snap)$/;

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export async function repoRoot(cwd: string) {
  return git(cwd, "rev-parse", "--show-toplevel").then(
    (out) => out.trim(),
    () => null,
  );
}

async function baseFile(root: string, agentId: string) {
  // The agent ID becomes a file name, so accept only the characters Paseo uses for IDs.
  if (!/^[\w-]+$/.test(agentId)) throw new Error(`Unexpected agent ID: ${agentId}`);
  const gitDir = (await git(root, "rev-parse", "--absolute-git-dir")).trim();
  return join(gitDir, "paseo-rules", `${agentId}.base`);
}

async function head(root: string) {
  // A repository without commits has no HEAD, so everything is compared with the empty tree.
  return git(root, "rev-parse", "HEAD").then(
    (out) => out.trim(),
    async () => (await git(root, "hash-object", "-t", "tree", "/dev/null")).trim(),
  );
}

// Records the commit the agent started on, once. Kept in the git directory so it survives a
// plugin reload and is never committed.
export async function rememberBase(cwd: string, agentId: string) {
  const root = await repoRoot(cwd);
  if (!root) return;
  const file = await baseFile(root, agentId);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, await head(root), { flag: "wx" }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
}

export async function forgetBase(cwd: string, agentId: string) {
  const root = await repoRoot(cwd);
  if (root) await rm(await baseFile(root, agentId), { force: true });
}

// Without a recorded base only uncommitted changes are compared.
export async function readBase(root: string, agentId: string) {
  const recorded = await readFile(await baseFile(root, agentId), "utf8").catch(() => "");
  return recorded.trim() || head(root);
}

export async function changedFiles(root: string, base: string) {
  const list = (out: string) => out.split("\0").filter(Boolean);
  const tracked = list(await git(root, "diff", "--name-only", "--diff-filter=d", "-z", base));
  const untracked = list(await git(root, "ls-files", "--others", "--exclude-standard", "-z"));
  const all = [
    ...tracked.map((file) => ({ file, untracked: false })),
    ...untracked.map((file) => ({ file, untracked: true })),
  ].filter(({ file }) => !GENERATED.test(file));
  return { files: all.slice(0, MAX_FILES), skipped: Math.max(all.length - MAX_FILES, 0) };
}

// The added-line range of one hunk, or its first line when the hunk only removes lines.
function addedRange(hunk: string): [number, number] {
  const start = Number(/^@@ -\S+ \+(\d+)/.exec(hunk)?.[1] ?? 1);
  let line = start;
  let first = 0;
  let last = 0;
  for (const text of hunk.split("\n").slice(1)) {
    if (text.startsWith("+")) {
      first ||= line;
      last = line;
    }
    if (!text.startsWith("-") && !text.startsWith("\\")) line += 1;
  }
  return first ? [first, last] : [start, start];
}

// One unit per file, split at hunk boundaries when the diff is too large for one judge call.
export function splitDiff(file: string, diff: string): Unit[] {
  const [header, ...hunks] = diff.split(/^(?=@@ )/m);
  const units: Unit[] = [];
  let group: string[] = [];
  const flush = () => {
    if (group.length === 0) return;
    units.push({
      file,
      part: units.length,
      diff: header + group.join(""),
      lines: group.map(addedRange),
    });
    group = [];
  };
  for (const hunk of hunks) {
    const size = group.reduce((sum, text) => sum + text.length, 0);
    if (size + hunk.length > MAX_UNIT_CHARS) flush();
    // lazy: a single hunk above the limit is cut, so its tail goes unjudged.
    // Upgrade path: split the hunk by lines and judge each piece.
    group.push(hunk.slice(0, MAX_UNIT_CHARS));
  }
  flush();
  return units;
}

export async function fileUnits(root: string, base: string, file: string, untracked: boolean) {
  const diff = untracked
    ? // --no-index exits with 1 when the files differ, which is every time here.
      await run("git", ["diff", "--no-index", "-U20", "--", "/dev/null", file], {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
      }).then(
        ({ stdout }) => stdout,
        (error) => (error?.code === 1 && typeof error.stdout === "string" ? error.stdout : Promise.reject(error)),
      )
    : await git(root, "diff", "-U20", base, "--", file);
  // A binary file has a diff header but no hunks, so it produces no units.
  return splitDiff(file, diff);
}
