---
name: paseo-implement
description: Implement an approved Paseo plan (.paseo/plans/*.html) against its definition of done. Work until every "Done when" criterion is verified with evidence, respect the plan's guardrails, use subagents where the work splits, and keep a progress log and the ticked criteria in the plan so the Paseo plan panel shows progress. Use when a message starts with "[plan-panel implement]", when the user asks to implement, build, execute, or resume a plan from .paseo/plans/, or says "/paseo-implement".
user-invocable: true
argument-hint: "<plan file>"
---

# Paseo implement

You implement one approved plan. The plan is a contract with three parts: **Task** (what will be true), **Guardrails** (Always / Ask first / Never), and **Done when** (the criteria that end the work). There are no steps in it on purpose: you read the code and choose the order. You are finished when every criterion passes and you can show the evidence, not when the code looks complete.

**Input:** $ARGUMENTS, or the `[plan-panel implement]` message, which names the plan file. Without either, use the newest `.paseo/plans/*.html` whose `plan-status` is `approved`, and say which one you picked.

## Start

1. Read the whole plan, including every `details` block. Read the files and docs listed under Context.
2. If an `aside class="ask"` question is still open, ask it now and wait. Do not guess an answer to a question the user was asked.
3. Set `plan-status` to `approved` if it is not already.
4. Record `git status --porcelain` as the baseline: changes that were there before you started are not yours.
5. Add the progress log (below) with a "Started" entry, then begin.

**Resume.** If the plan already has a log and ticked criteria, read the log first, re-run the checks of the ticked criteria (the code may have changed since), and continue from the open ones.

## Work loop

Repeat until every criterion is done, or you are blocked:

1. Pick the next open criterion. Mark it `class="doing"` in the plan.
2. Implement what it needs, in whatever order the code suggests. Re-read the guardrails when you are about to touch anything new.
3. Run its check: the command or manual check in its `details`, or the most direct test of the criterion's wording if it has none. Run the repo's fast checks (typecheck, lint, the affected tests) too.
4. When it passes, change `doing` to `done` and append a log entry with the evidence. When it fails, fix and re-run. Ticking a criterion without having run its check is never allowed.

Earlier criteria can break while you work on later ones. Before the final report, re-run every check.

## Subagents

You may delegate, and you stay responsible: you verify everything a subagent reports before ticking a criterion.

Delegate when it keeps your context lean or saves wall-clock time:

- **Exploration** that would read many files to answer one question ("where are upload events emitted and consumed?"). Ask for the answer and the file paths, not file dumps.
- **Independent parts** that touch disjoint files, such as backend and UI against an agreed interface. Settle the interface first and give each subagent its own files.
- **A large self-contained part** that would crowd your context, such as a migration with its tests.

Do not delegate a change you could make in a few edits, and never let two subagents edit the same files at the same time.

Brief a subagent with:

- The plan file path.
- Which criteria or which part it owns.
- The guardrails, verbatim.
- The files it may change.
- What to return: what changed, the commands it ran with their results, and anything it could not do.

Use your provider's subagent tool when it has one (Claude Code's Agent tool, Codex subagents), or `create_agent` from the **paseo** skill.

## Guardrails

- **Always** items hold the whole time, not just at the end.
- **Ask first:** stop before the action, log it, ask the user in chat with your recommendation, and end your turn. Continue with other criteria only if they do not depend on the answer.
- **Never:** do not do it, even if it would make a check pass. If a criterion seems to need it, you are blocked (below).
- Project rules in `CLAUDE.md` / `AGENTS.md` apply too.
- Do not commit, stash, reset, or discard changes unless the plan or the user says so. All work stays in the working tree for review.

## When reality disagrees with the plan

- **Small deviation that keeps every criterion and guardrail** (a different file, an extra helper): do it and log it.
- **The plan is wrong or incomplete** (a criterion cannot be met as written, a decision does not fit the code, the scope is clearly bigger): stop, log it, and ask the user, with a proposed change to the plan. When they agree, update the plan as the planner would: bump `plan-revision` and mark changed elements with `data-revised`. Never weaken a criterion on your own.
- **Blocked** (the same failure after about three different attempts, missing access or credentials, a flaky environment): stop, log the blocker with what you tried, and ask. Do not loop on the same fix.

## Progress log

The log lives in the plan, after Done when, so the panel shows it:

```html
<section id="log">
<h2>Progress</h2>
<ul>
<li><b>Started</b> baseline clean, 4 criteria open</li>
<li class="ok"><b>done-1</b> <code>pnpm e2e notifications</code> passes, bell updated in ~1 s</li>
<li class="warn"><b>Deviation</b> consumer in <code>src/queue/</code>, workers dir is legacy</li>
<li class="ask"><b>Asked</b> new dependency <code>mjml</code>? (guard-3)</li>
</ul>
</section>
```

- Append only. One line per entry: a short bold label, then a fragment. Tones: `ok` criterion verified, `warn` deviation or surprise, `ask` waiting on the user, `risk` blocked.
- Log checkpoints, not activity: criteria verified with their evidence, deviations, decisions you made, questions asked, blockers. Not "read file X".
- The log is how a fresh session resumes, so a reader with no other context should be able to tell what is done and what is next.
- Status edits (ticking criteria, log entries) need no revision bump.

## Finish

When every criterion is `done` and a final run of all checks is green:

1. Set `plan-status` to `done` and add a final log entry.
2. Reply with a short report:

```
Done: <plan title>
✓ done-1 <criterion> — <command or check> → <result>
✓ done-2 …
Files: <git status --porcelain entries new since the baseline>
Deviations: <from the log, or none>
Follow-ups: <anything out of scope you noticed, or none>
Changes are uncommitted and ready for review.
```

Do not start a review yourself unless the user asks. If you stop before finishing, report the same way with each open criterion and what is in the way.
