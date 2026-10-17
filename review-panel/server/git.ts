import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DiffHunk, DiffLine, FileDiff, fileDiffRpc } from "../shared/contracts";

/** Rows beyond this are dropped and the diff is flagged as truncated. */
const MAX_ROWS = 4000;

class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 20_000,
        // Optional locks off: a read-only diff must not take index.lock while the agent is committing.
        // Literal pathspecs: a file named ":(glob)x" is a file name, not pathspec magic.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1", LC_ALL: "C" },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        // Spawn failures (ENOENT) and timeouts carry no exit code; keep them as they are.
        if (typeof error.code !== "number") return reject(error);
        reject(new GitError(stderr.trim() || error.message, error.code));
      },
    );
  });
}

function friendlyGitError(error: unknown, revisions: readonly string[]): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/not a git repository/i.test(message)) return new Error("This workspace is not a git repository.");
  if (/unknown revision|bad revision|bad object|invalid object name/i.test(message)) {
    return new Error(
      `Git does not know ${revisions.map((rev) => `"${rev}"`).join(" or ")}. The review may come from another clone, or the commit was rewritten.`,
    );
  }
  if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
    return new Error("git is not installed or not on the daemon's PATH.");
  }
  return new Error(message);
}

/** Workspace-relative POSIX path, or an error when the path leaves the workspace. */
export function workspaceRelativePath(directory: string, file: string): string {
  let candidate = file.trim().replace(/\\/g, "/");
  if (path.isAbsolute(candidate)) candidate = path.relative(directory, candidate);
  const resolved = path.resolve(directory, candidate);
  const relative = path.relative(directory, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`"${file}" is not a file inside the workspace.`);
  }
  return relative.split(path.sep).join("/");
}

/** Parse `git diff` output for a single file into hunks with old and new line numbers. */
export function parseUnifiedDiff(text: string): Pick<FileDiff, "hunks" | "truncated"> & {
  added: boolean;
  deleted: boolean;
  binary: boolean;
} {
  const hunks: DiffHunk[] = [];
  let added = false;
  let deleted = false;
  let binary = false;
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let rows = 0;
  let truncated = false;

  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      current = { section: header[3] ?? "", oldStart: oldLine, newStart: newLine, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) {
      if (line.startsWith("new file mode")) added = true;
      else if (line.startsWith("deleted file mode")) deleted = true;
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") binary = true;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      current = null;
      continue;
    }
    let row: DiffLine | null = null;
    switch (line[0]) {
      case "+":
        row = { kind: "add", oldLine: null, newLine: newLine++, text: line.slice(1) };
        break;
      case "-":
        row = { kind: "del", oldLine: oldLine++, newLine: null, text: line.slice(1) };
        break;
      case " ":
        row = { kind: "context", oldLine: oldLine++, newLine: newLine++, text: line.slice(1) };
        break;
      default:
        // "\ No newline at end of file" and the empty string after the final newline.
        break;
    }
    if (!row) continue;
    if (rows >= MAX_ROWS) {
      truncated = true;
      break;
    }
    current.lines.push(row);
    rows += 1;
  }
  return { hunks: hunks.filter((hunk) => hunk.lines.length > 0), truncated, added, deleted, binary };
}

/** A whole file as one hunk: context rows for an unchanged file, added rows for an untracked one. */
function wholeFile(content: string, kind: "context" | "add"): Pick<FileDiff, "hunks" | "truncated"> {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const truncated = lines.length > MAX_ROWS;
  const rows: DiffLine[] = lines.slice(0, MAX_ROWS).map((text, index) => ({
    kind,
    oldLine: kind === "context" ? index + 1 : null,
    newLine: index + 1,
    text: text.endsWith("\r") ? text.slice(0, -1) : text,
  }));
  return { hunks: rows.length > 0 ? [{ section: "", oldStart: 1, newStart: 1, lines: rows }] : [], truncated };
}

function looksBinary(content: string): boolean {
  return content.slice(0, 8000).includes("\u0000");
}

async function showAtRevision(directory: string, revision: string, file: string): Promise<string | null> {
  try {
    // `rev:./path` resolves relative to the working directory, which is the workspace, not the repo root.
    return await git(directory, ["show", `${revision}:./${file}`]);
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

async function isTracked(directory: string, file: string): Promise<boolean> {
  try {
    await git(directory, ["ls-files", "--error-unmatch", "--", file]);
    return true;
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw error;
  }
}

export async function computeFileDiff({
  directory,
  base,
  head,
  file,
  context,
}: RpcInput<typeof fileDiffRpc>): Promise<RpcOutput<typeof fileDiffRpc>> {
  if (!path.isAbsolute(directory)) throw new Error("Workspace directory must be an absolute path.");
  const relative = workspaceRelativePath(directory, file);
  const revisions = head ? [base, head] : [base];

  let output: string;
  try {
    output = await git(directory, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      `--unified=${context}`,
      ...revisions,
      "--",
      relative,
    ]);
  } catch (error) {
    throw friendlyGitError(error, revisions);
  }

  if (output.trim().length > 0) {
    const parsed = parseUnifiedDiff(output);
    if (parsed.binary) return { status: "binary", hunks: [], truncated: false };
    const status = parsed.added ? "added" : parsed.deleted ? "deleted" : "modified";
    return { status, hunks: parsed.hunks, truncated: parsed.truncated };
  }

  // The file is not part of the diff: show it whole so the finding's lines are still visible.
  if (head) {
    const content = await showAtRevision(directory, head, relative);
    if (content === null) return { status: "missing", hunks: [], truncated: false };
    if (looksBinary(content)) return { status: "binary", hunks: [], truncated: false };
    return { status: "unchanged", ...wholeFile(content, "context") };
  }

  let content: string;
  try {
    content = await fs.readFile(path.join(directory, relative), "utf8");
  } catch {
    return { status: "missing", hunks: [], truncated: false };
  }
  if (looksBinary(content)) return { status: "binary", hunks: [], truncated: false };
  // `git diff <base>` leaves out untracked files, so a brand-new file shows up here.
  return (await isTracked(directory, relative))
    ? { status: "unchanged", ...wholeFile(content, "context") }
    : { status: "added", ...wholeFile(content, "add") };
}
