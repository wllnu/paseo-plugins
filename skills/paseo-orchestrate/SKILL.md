---
name: paseo-orchestrate
description: Run a roadmap of work packages (.paseo/plans/*.roadmap.md) as the orchestrator. For each package, launch a scout agent that explores the code and writes a focused brief, then a builder agent that implements it; verify the result, mark progress in the roadmap so the Paseo plan panel shows it, and pause for the user's review after every package. Use when a message starts with "[plan-panel run]" or "[plan-panel continue]", when the user asks to run, execute, resume, continue, or orchestrate a roadmap, or says "/paseo-orchestrate".
user-invocable: true
argument-hint: "<roadmap file>"
---

# Paseo orchestrate

You run a roadmap. Each work package goes to two fresh agents: a scout that turns the coarse package into an exact brief, and a builder that implements the brief. You sequence the packages, gate the briefs, verify the results, and keep the roadmap file honest so the user can follow the run in the Plan panel. You never write code yourself.

**The user reviews every package.** After each one you stop and wait. The next package starts only when the user tells you to continue, in chat or with the panel's **Continue** button (`[plan-panel continue]`).

**Input:** $ARGUMENTS, or the `[plan-panel run]` message, which names the roadmap file, the plan file, and the briefs folder. Without either, use the newest `.paseo/plans/*.roadmap.md`.

## Roles

| Agent | Profile | Job | Writes |
| --- | --- | --- | --- |
| You, orchestrator | — | Sequence, gate, verify, report | `Status:` lines in the roadmap, progress marks in the plan |
| Scout | Planner | Reads the code for one package, decides the exact changes | `<briefs>/wp-N.md` only |
| Builder | Builder | Implements one brief, runs its checks | Source files, `## Result` in the brief |

Splitting the work keeps each context small: the scout's exploration never reaches the builder, and the builder starts from a short brief whose paths and patterns were verified against the code.

## Setup

1. Read the **paseo** skill: `create_agent`, `send_agent_prompt`, `archive_agent`, `list_profiles`, and the waiting rules.
2. Read the roadmap in full, then the plan it names on its `Plan:` line. The plan's Decisions and "Done when" bind every package.
3. Pick profiles with `list_profiles`. Use the Scout and Builder named in the roadmap's Run section. If it names none, use profiles named Planner and Builder; failing that, the profiles whose notes fit exploration and implementation; failing that, your own provider. A package's own Builder row overrides the default for that package. Tell the user your choice in one line.
4. Create the briefs folder. Record `git status --porcelain` as the baseline; changes that were there before the run are not a builder's doing.

**Resume.** Packages may carry a status from an earlier run. Skip `done` and `skipped`. For `scouting`, `building`, or `blocked`: a brief whose `## Result` says DONE goes to Verify, a brief without a Result goes to Build, and no brief goes to Scout. Retry a `blocked` package only once its blocker is resolved. A package in `review` is waiting for the user: report it again (step 5) and stop.

## The loop

Take packages in document order. The next package is the first open one whose Needs are all `done`. Run one agent at a time: builders share the working tree, and a scout reading code mid-change writes a stale brief.

### 1. Scout

1. Re-read the roadmap. The user or the planning agent may have revised it since the last package.
2. Set the package to `Status: scouting`.
3. `create_agent` with title `[Scout] wp-N <title>`, the scout profile, and the scout prompt from `references/agent-prompts.md`. Leave `notifyOnFinish` on, end your turn, and wait for the notification. Do not poll.

### 2. Gate the brief

Read `<briefs>/wp-N.md`. Accept it when:

- Status is READY.
- Every change names a file, and the changes stay inside the package (nothing listed under its "Not here", nothing owned by another package).
- Verify lists commands that exist in this repo.
- The size fits one builder: about 8 files or fewer.

Otherwise send the scout what to fix with `send_agent_prompt` (at most two rounds). If the package is too big, have the scout cut it to a first part and list the rest; ask the user whether to add the rest as a new package.

If the brief is BLOCKED on a question: answer it yourself when the plan or roadmap decides it, and send the answer to the scout. Otherwise set it to `blocked` and ask the user (see Blocked packages).

### 3. Build

1. Set the package to `Status: building`.
2. `create_agent` with title `[Build] wp-N <title>`, the builder profile, and the builder prompt from `references/agent-prompts.md`. Wait for the notification.

### 4. Verify

1. Read the brief's `## Result`.
2. Run the brief's Verify commands and the roadmap's Checks yourself.
3. Compare `git status --porcelain` with the baseline and the files earlier packages changed. The new changes should match the brief's Changes. Ask the builder about unexpected files; do not revert anything yourself.
4. On failure, send the failing command and the relevant lines of output to the same builder with the fix-round prompt. At most two rounds; then the package is blocked.

### 5. Pause for review

1. Set the package to `Status: review`.
2. Note the files this package changed: the `git status --porcelain` entries that are new since the previous package.
3. Report and end your turn:

```
wp-N <title> is ready for your review.
Outcome: <one line>
Files: <files this package changed, new ones marked (new)>
Verify: <command> ✓|✗, one per line
Deviations: <from the brief's Result, or none>
Brief: <briefs dir>/wp-N.md
Next: wp-M <title>, or "last package"
Say "continue" or press Continue on the roadmap to go on, or tell me what to change.
```

4. Keep the scout and builder alive: review feedback goes to the same builder, which still has the context.

Do not start the next package in the same turn, and do not treat silence, a finish notification, or a question as a go-ahead.

### 6. On the user's reply

- **Continue** (`[plan-panel continue]`, "continue", "next", "looks good, go on"): if files changed since your report (the user edited them), run the roadmap's Checks first and report failures instead of continuing. Then close the package: set `Status: done`; in the plan file, mark a step `class="done"` once every package covering it is done and tick the checks you verified; archive the scout and builder with `archive_agent`. Start the next package at step 1.
- **Changes requested**: send them to the same builder with the review-round prompt from `references/agent-prompts.md`, verify again (step 4), and pause again (step 5). If a requested change belongs to a later package, say so and add it to that package as a `- Note: <change>` bullet instead.
- **Skip, stop, or reorder**: do as asked. Skipped packages get `Status: skipped`.
- **A question**: answer it and stay paused.

## Status

Each package in the roadmap has one `Status:` line under its `### wp-N: Title` heading; the panel shows it as the package's progress. Change only that line, plus a `- Blocked: <reason>` bullet for blocked packages (remove it when the package is retried). Edit the line in place rather than rewriting the file, and re-read the file right before each edit: the planning agent may revise it during the run.

| Status | When |
| --- | --- |
| `open` | Not started |
| `scouting` | Scout is writing the brief |
| `building` | Builder is implementing |
| `review` | Verified, waiting for the user's go-ahead |
| `done` | Approved by the user |
| `blocked` | Stopped; add `- Blocked: <one-line reason>` |
| `skipped` | Only when the user asks |

## Blocked packages

Set the package to `blocked` with a one-line reason, keep its scout and builder alive, and stop: tell the user what is blocked, why, and what you need from them. Their answer may unblock it (retry), skip it, or tell you to continue; then go on with the next package whose Needs are all `done`.

## Finish

When the user approves the last package and every package is done or skipped, reply with a short report: one line per package (id, title, result), `git diff --stat`, deviations the builders reported, follow-ups from their notes, and how to verify the whole change (the plan's "Done when"). Say that all changes are uncommitted and ready for review. Do not start a review yourself; the user starts it.

## Rules

- Never write or edit source code. Never commit, stash, reset, check out, or discard changes.
- Never start a package without the user's go-ahead on the previous one.
- One agent at a time.
- Trust finish notifications. Scouts and builders can take 10–30 minutes; do not poll or send hurry-ups.
- Keep your own context lean: read briefs, results, and command output. Do not read source files beyond what a gate needs.
- Messages from the user during the run come first: pause, skip, stop, reorder, or answer as asked.
- When a scout or builder errors or waits on a permission, tell the user. Do not approve risky permissions on their behalf.
