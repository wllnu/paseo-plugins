---
name: paseo-review
description: Review code changes and write the findings, classified as blocking, should fix, and nitpicks, to .paseo/reviews/ where the Paseo review panel shows them next to the diff; then fix the findings the user sends back from the panel. Use when the user asks to review code, a branch, a PR, a commit, or uncommitted changes, says "review this", "code review", "/paseo-review", or when a message starts with "[review-panel fix]".
user-invocable: true
argument-hint: "<what to review>"
---

# Paseo review

Review a change and hand the findings to the user through the Paseo **Review** panel. The panel groups findings into blocking, should fix, and nitpicks, lets the user tick the ones to fix and send them back to an agent, and opens every file reference in a diff view at the exact lines. Your job is to make each finding correct, well classified, and precisely located, because the user acts on it without rereading the code.

**User's request:** $ARGUMENTS

## The flow

1. **Pin the scope**: the exact diff under review, as commit SHAs.
2. **Review** the diff and the code around it. Record only findings you confirmed.
3. **Classify** each finding as blocking, should-fix, or nit.
4. **Locate** each finding with verified line numbers.
5. **Write** `.paseo/reviews/<slug>.json` in the format from `references/review-format.md`.
6. **Hand over** and stop.
7. **Fix** when `[review-panel fix]` arrives.

If a message starting with `[review-panel fix]` arrives, skip to step 7.

## Step 1: Pin the scope

The panel diffs `scope.base` against `scope.head` to show each finding, so the scope must be reproducible later.

| Request | base | head |
| --- | --- | --- |
| This branch, this PR (default) | `git merge-base HEAD <default branch>` | `git rev-parse HEAD`, or `null` when there are uncommitted changes to review too |
| Uncommitted or staged changes | `git rev-parse HEAD` | `null` (working tree) |
| One commit `<sha>` | `git rev-parse <sha>^` | `git rev-parse <sha>` |
| A PR by number | merge-base with the PR's base branch | the PR head SHA, fetched locally (`gh pr checkout <n>` or `git fetch origin pull/<n>/head`) |

- Find the default branch with `git symbolic-ref --short refs/remotes/origin/HEAD`; fall back to `main` or `master`.
- Always store full SHAs, never `origin/main` or a branch name: those move and the line numbers stop matching. Put the human names in `baseLabel` and `headLabel`.
- `head: null` means the panel compares against the live working tree, which also catches untracked new files. Use it only when uncommitted work is part of the review. A committed head keeps the review stable while fixes land.
- Collect the change: `git diff <base> [<head>] --stat`, then the full diff. For a working-tree review, also `git status --porcelain` and read untracked new files in full.

## Step 2: Review

Read the whole diff first, then the code around every hunk: callers, callees, types, tests, and config the change relies on. Check, in priority order:

1. **Correctness**: wrong results, unreachable or missing branches, off-by-one, null and empty cases, async ordering, races.
2. **Security and data**: injection, auth and permission checks, secrets, unsafe input handling, data loss or corruption.
3. **Contracts**: breaking API or schema changes, migrations, backwards compatibility, error behavior callers depend on.
4. **Failure handling**: errors swallowed or surfaced wrongly, retries, timeouts, cleanup.
5. **Tests**: new logic without tests, tests that do not test what they claim, flaky patterns.
6. **Performance**: work on hot paths, N+1 queries, unbounded growth.
7. **Maintainability and readability**: duplication that will drift, misleading names, dead code, project convention breaks.

Rules:

- **Confirm every finding** by reading the code path it depends on. If you cannot confirm it, leave it out or raise it as a question in `summary`. A wrong finding costs the user more than a missing nit.
- Follow the project's own rules (CLAUDE.md, AGENTS.md, lint and format config). Breaking an explicit project rule is at least should-fix.
- If the user named requirements or a ticket, check the change against them; a missed requirement is blocking.
- Review the change, not the whole codebase. A serious problem in untouched code goes into `summary`, not into findings.
- For a large change you may split the reading across subagents, but you write the one review file and verify every line number yourself.

## Step 3: Classify

| Severity | Meaning | Typical findings |
| --- | --- | --- |
| `blocking` | Must be fixed before this merges. | Bug on a reachable path, crash, security hole, data loss, broken build or tests, breaking change without migration, missed requirement |
| `should-fix` | A real problem; fix it in this change unless there is a reason not to. | Unhandled edge case or error at a boundary, missing tests for new logic, hot-path performance issue, misleading API or name, duplicated logic, convention break |
| `nit` | Optional polish. The code is correct without it. | Naming, small readability gains, comments, a simpler idiom, formatting tooling misses |

- When torn between two levels, pick the lower one and say why in `detail`. Inflated severities make the panel useless for triage.
- Not findings: things the code already handles, preferences without a concrete benefit, and anything a formatter or linter in the project already enforces.
- `verdict`: `changes-requested` when there is at least one blocking finding, `approve` when there are only nits or nothing, otherwise your judgement (`comment` when you only have should-fix findings worth discussing).

## Step 4: Locate

Locations drive the panel's jump to the diff, so wrong line numbers break the main feature.

- `file`: workspace-relative path, exactly as `git diff --name-only` prints it.
- `line` and `endLine` count in the **head version** of the file: `git show <head>:<file>`, or the working-tree file when `head` is null. Read the file with line numbers (`git show <head>:<file> | nl -ba | sed -n '30,60p'`, or your file-reading tool on the working tree). Never count lines inside a diff hunk by hand.
- Cover the offending code, usually 1 to 15 lines. Point at the changed lines that cause the problem. When the cause is unchanged code next to the change, point there; the panel shows it as context and says so.
- For code the change **deleted**, such as a removed check, use `"side": "old"` with line numbers in the base version (`git show <base>:<file> | nl -ba`).
- When several places are involved, give several locations, the most important first, each with a short `note`.
- In `detail`, `fix`, and `summary`, cite other code as `path/to/file.ts:42` or `file.ts:42-48`; the panel turns these into diff links. Wrap identifiers in backticks.

## Step 5: Write the review file

Read `references/review-format.md` and copy the shape of `references/example-review.json`.

- Write to `.paseo/reviews/<slug>.json` in the workspace root. `<slug>` is kebab-case from what you reviewed, for example `upload-retry-branch.json`. A re-review after fixes gets a new file (`upload-retry-branch-2.json`); the panel lists the newest first.
- Ids are `B1, B2…` for blocking, `S1…` for should-fix, `N1…` for nits, numbered by importance within each severity. Never renumber later.
- Each finding: a `title` of at most about 10 words; `symptom` in plain language, what a user or caller notices (required for blocking and should-fix, optional for nits); `detail` with the cause and the evidence in 1 to 4 sentences; `fix` with a concrete suggestion.
- Validate before handing over: `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' .paseo/reviews/<slug>.json`. The panel also lists schema problems at the top of the review.
- Keep the file out of commits unless the user asks. If the repository does not ignore `.paseo/`, append `.paseo/` to `.git/info/exclude` (local only, not `.gitignore`).

## Step 6: Hand over

Send one short message:

- The verdict and the counts, for example "Changes requested: 2 blocking, 3 should fix, 4 nits."
- One line per blocking finding: `B1 retry.ts:42 Retry loop never stops on 4xx`.
- Where to look: the **Review** tab in the workspace, the Command Center item **Open review panel**, or `/review-panel` in the composer. Tick findings there and press **Fix** to send them back.

Then stop. Do not paste every finding into the chat; the panel is the review surface. Do not start fixing unless the user asks. If the user cannot see the panel, the `review-panel` plugin needs to be installed and running in Paseo (Settings → Plugins).

## Step 7: Fix from the panel

The user's selection arrives as a message starting with `[review-panel fix]`. It names the review file and the reviewed diff, then lists each finding with its id, severity, title, `Where`, `Symptom`, `Detail`, `Fix`, and possibly `My comment`, and may end with a `Note from me` that overrides the suggestions.

1. Read the review file and the current code at every location; code may have moved since the review.
2. Check each finding is real. If it is not, do not change code for it: mark it `wont-fix` with the reason.
3. Fix the rest, blocking first, following the user's note. A finding's `My comment` overrides its `Fix`. Ask before a fix that needs a product decision; fix the others in the same turn.
4. Run the relevant tests, typecheck, and lint.
5. Set `resolution` on each listed finding in the review file: `{"status": "fixed", "note": "what changed, file:line", "at": "<ISO time>"}` or `{"status": "wont-fix", "note": "why"}`. Change nothing else in the file: no new ids, no removed findings. The panel shows the resolution next to the finding.
6. Reply with one line per id (`B1 fixed: stop retrying on 4xx, retry.ts:44`) and the checks you ran.

Leave findings that were not in the message untouched.

## Reference files

- `references/review-format.md`: every field of the review file, with the rules the panel enforces.
- `references/example-review.json`: a complete review to copy the shape and terseness from.
