---
name: paseo-plan
description: Refine a request through a sized interview, then write a short HTML plan (task, guardrails, definition of done) to .paseo/plans/ that the Paseo plan panel renders, and revise it from the panel's comments until the user approves it. Use when the user asks to plan, spec, scope, design, or refine a feature or change before building it, says "make a plan", "plan this", "let's plan", "/paseo-plan", or when a message starts with "[plan-panel feedback]".
user-invocable: true
argument-hint: "<what to plan>"
---

# Paseo plan

Turn a rough request into a plan the user can review and annotate in the Paseo **Plan** panel. Interview first, then write the plan as HTML, then revise it from the comments the user sends back from the panel. Do not implement anything until the user approves the plan.

A plan is a contract, not a recipe. It says **what** to build and why (Task), **what must not happen** (Guardrails), and **how anyone can tell it is finished** (Done when). It never lists implementation steps: the implementing agent reads the code and decides the order itself, and step lists go stale the moment the code disagrees with them.

**User's request:** $ARGUMENTS

## The flow

1. **Size the request** and pick an interview budget.
2. **Interview** the user in batched rounds until the open questions are closed.
3. **Write the plan** to `.paseo/plans/<slug>.html` using the template and HTML subset in `references/`.
4. **Hand the plan to the user** and stop.
5. **Revise** when `[plan-panel feedback]` arrives. Repeat until the user approves.
6. **Implement** once approved, with the `paseo-implement` skill.

If a message starting with `[plan-panel feedback]` arrives, skip to step 5. If it starts with `[plan-panel implement]`, go to step 6.

## Step 1: Size the request

Look at the codebase before asking anything. Find the files the request touches, the existing patterns, the test and check commands, and anything that already does part of the job. Questions the code can answer are never asked.

Then size the request:

| Size | Typical shape | Interview budget |
| --- | --- | --- |
| XS | One file, obvious change, no product decision | None; confirm your reading in one sentence and go to the plan |
| S | A few files, one clear feature | 1 round, 2–4 questions |
| M | New component, API, or workflow; several ways to do it | 2 rounds, 4–8 questions total |
| L | Cross-cutting change, migration, new subsystem, or unclear goal | 2–4 rounds, 8–15 questions total, with a written summary between rounds |

Size on uncertainty, not on effort. A large but fully specified task is S. A small task whose purpose is unclear is M.

Tell the user the size in one line before the first round, for example: "This is a medium-sized change, I have 5 questions before I write the plan."

## Step 2: Interview

The interview fills the plan's three sections. Cover, in this order, skipping anything already clear:

1. **Outcome** (Task). What should be true when this is done, and for whom? Why now?
2. **Decisions** (Task). Where two or more sensible designs exist, present them with a recommendation and a one-line trade-off each. What is explicitly out of scope?
3. **Boundaries** (Guardrails). What must not change? What should the implementer ask about before doing it: new dependencies, schema or public API changes, touching a shared module?
4. **Acceptance** (Done when). How will the user check the result? What would make them reject it? Which command, test, or manual check proves each part?
5. **Unknowns you found in the code.** Dead code, conflicting patterns, missing tests that change the plan.

Rules:

- Ask in **batched rounds**, never one question at a time. Stay within the budget per round.
- Every question states **why it matters** in a few words and offers a **recommended default** when you have one. The user should be able to answer "defaults are fine".
- Prefer **closed questions** with options. Use the `AskUserQuestion` tool when it is available; otherwise write a numbered list and wait.
- Never ask what you can read from the code, the git history, or the conversation.
- After each round, **restate the decisions** in one short list before asking the next round or writing the plan.
- Stop when the remaining uncertainty would not change the plan. Do not interview for completeness.
- If the user says "just plan it" or answers with defaults, stop asking and write the plan under stated assumptions, tagged `assumed`.

## Step 3: Write the plan

Read `references/plan-template.html` and `references/html-subset.md` before writing. The panel renders a fixed HTML subset natively, plus a small set of visual components selected with `class`; anything outside it loses structure.

**Location and naming**

- Write to `.paseo/plans/<slug>.html` relative to the workspace root (your working directory). Create the directory if needed.
- `<slug>` is kebab-case from the title, for example `notify-on-upload-finish.html`. One plan per request. Keep the same file across revisions.
- Keep the file out of commits unless the user asks for it. If the repository does not ignore `.paseo/`, append `.paseo/` to `.git/info/exclude` (local only, not `.gitignore`).

**Two readers**

The user reviews the plan in a narrow side panel and should grasp it in about a minute. An agent implements from it later, possibly in a fresh context, and needs what it cannot see in the code. Visible items are short fragments for the user; specifics only the implementer needs (paths, commands, thresholds, edge cases) go into a collapsed `<details>`. Collapsed content is still part of the plan: the user can open and comment on it, and it binds the implementer.

**Sections**

In this order; drop a section only when it would be empty:

| Section | Contents | Ids |
| --- | --- | --- |
| `header` | `h1`; `p id="summary"`: what and why, at most 40 words; `ul class="facts"`, 2–4 chips; one `aside class="ask"` per open question that blocks approval | `question-N` |
| `task`, heading "Task" | `ul` of outcomes: what will be true, in terms the user can see, not code changes. Then a `dl` of decisions, including "Out of scope". Then `details` "Context": the files, patterns, and docs the implementer should read first | `task-N`, `decision-N` on the `dt` |
| `guardrails`, heading "Guardrails" | `div class="compare"` with three columns: `ok` "Always", `ask` "Ask first", `no` "Never". Drop an empty column | `guard-N`, numbered across columns |
| `done`, heading "Done when" | `ul class="checks"`: each criterion is an observable result, with a `details` inside saying how to verify it when that is not obvious. The last criterion is usually the repo's own checks passing | `done-N` |

The implementing agent adds a `log` section ("Progress") below; never write one into a plan yourself.

**What makes each section good**

- **Task** describes outcomes, not work. "Bell shows an unread count", not "Add a Bell component". Decisions record what the interview settled, so the implementer does not reopen them; a decision with real alternatives says which was chosen and, in a few words, what was rejected. "Context" lists only what is not obvious from the repo, such as the existing pattern to copy, the event to hook into, or the doc that explains a constraint.
- **Guardrails** are specific to this task and concrete enough to check: name the path, the command, the dependency. "Never edit `src/legacy/`", not "be careful with legacy code". Do not restate rules that already live in `CLAUDE.md` or `AGENTS.md`. Always: invariants the implementer must hold throughout. Ask first: actions that need the user's go-ahead mid-run (new dependencies, schema or public API changes, deleting files, anything irreversible). Never: the shortcuts a stuck agent is tempted by (editing or skipping tests to make them pass, widening scope, touching out-of-scope areas). If a Never matters every single time, also suggest a hook or deny rule in your hand-over message, since a plan is guidance and a hook is enforced.
- **Done when** is the stop condition. Every criterion must be verifiable by running something or looking at something, and must pass or fail without judgment: "Bell count updates within 5 s", not "notifications work well". Prefer end-to-end checks a user would do over unit tests alone. Put the exact command and expected result in the criterion's `details`. 2–6 criteria; if you need more, the plan is too big.

**Facts** are facts or your own assessment, never invented: Size (from Step 1), Area (the parts of the system touched), New (parts that do not exist yet), Risk (low, medium with `warn`, high with `risk`). One to three words per chip.

**Questions** are only open ones. A question the interview answered becomes a decision and disappears.

**Budgets**

| Size | Task items | Criteria | Whole file |
| --- | --- | --- | --- |
| XS/S | ≤ 3 | ≤ 3 | ≤ 3,000 bytes |
| M | ≤ 5 | ≤ 5 | ≤ 5,000 bytes |
| L | ≤ 7 | ≤ 6 | ≤ 8,000 bytes |

Measure the file with `wc -c`. Never drop a specific the implementer needs to meet a budget. If the plan is far over (about 25 % or more), the request is too big for one plan: tell the user and propose splitting it into separate plans that can be implemented one after another.

**Writing rules**

- Say each thing once. The summary says what and why; Task says what will be true; Done when says how to tell. A decision is not repeated as a guardrail.
- Statements in lists are fragments of about 4–12 words; titles, chips, and `dt` labels are shorter. No filler ("This will…", "We need to…").
- In visible text, use `code` only for names the user must recognize, such as the command they run to verify or a path a guardrail forbids. Other paths and commands belong in `details`.
- The detail layer is terse too: fragments, no prose, no pasted code beyond a short interface when the interface is itself a decision.
- No indentation. One block per line; short pairs such as `<dt>…</dt><dd>…</dd>` may share a line.

**Metadata**

- `<title>Plan: …</title>`
- `<meta name="plan-revision" content="1">`, bump on every revision
- `<meta name="plan-status" content="review">`: `draft` while writing, `review` when handed over, `approved` once the user approves, `done` when the implementer has verified every criterion

**Ids**

Give an id to every section, task item, decision, guardrail, criterion, and question. Other elements need none; comments on them are matched by position. Ids are how the panel attaches comments and how feedback refers back to the plan.

- A new plan numbers ids from 1 in document order.
- A revision never renumbers. New elements get new ids (`task-2b`, `done-5`). When two elements merge, the survivor keeps its id and the other is deleted.

## Step 4: Hand the plan to the user

After writing the file, send one short message:

- Where the plan is and how to open it: the **Plan** tab in the workspace, **Plans** in the sidebar, the Command Center item **Open plan panel**, or `/plan-panel` in the composer.
- The two or three decisions or guardrails most worth a second look.
- Any guardrail worth enforcing with a hook or permission rule.
- That you will wait for comments from the panel, or for **Implement**.

Then stop. Do not start implementing. Do not paste the plan into the chat; the panel is the review surface. If the user says they cannot see the panel, tell them the `plan-panel` plugin needs to be installed and running in Paseo (Settings → Plugins).

## Step 5: Revise from panel feedback

Feedback arrives as a message that starts with `[plan-panel feedback]` and lists numbered comments. Each comment carries:

- **Where:** a heading breadcrumb, the element kind, and the element id (`#guard-3`) or the anchor it sits inside (`inside #task`). A highlighted range that spans blocks reads `from … to …`.
- **Quote:** the text of the element the user selected, or
- **Selected:** the exact passage the user highlighted with the mouse. Treat a selected passage as the precise target: change that wording, not the whole element, unless the comment says otherwise.
- **Comment:** the user's note.

The user can select several elements for one comment. Then **Where** reads `N blocks` and is followed by one `- <location>: "<quote>"` line per element. The comment applies to all of them together, for example "merge these" or "same problem in each". A `facts` row, a `flow`, and an `aside` are selected as a whole and are reported as `fact chips`, `flow`, and `callout`.

A comment with **Where: whole plan** is about the plan overall.

Procedure:

1. Read the current plan file; the panel may be ahead of your memory of it.
2. For each comment, locate the element by id first, then by breadcrumb and quote. Decide what changes: the element itself, its section, or the whole plan.
3. If a comment is ambiguous or conflicts with an earlier decision, ask about that comment specifically before changing the plan. Apply the unambiguous ones in the same turn.
4. Rewrite the file in place: keep ids stable, bump `plan-revision`, add `data-revised="<new revision>"` to every element you changed or added, remove or rewrite anything the feedback invalidated, and record what the feedback decided as a decision.
5. Reply with a numbered list mirroring the comment numbers: one line per comment saying what changed and where (`#done-2`). Mention anything you chose not to change and why.

## Step 6: Implement

The user approves by pressing **Implement** in the panel, which sends `[plan-panel implement]` naming the plan file, or by saying so in chat. Unsent comments are not part of the approval; if the message mentions any, ask whether to address them first.

Set `plan-status` to `approved` (no revision bump), then follow the `paseo-implement` skill: it covers working against the criteria, subagents, the progress log, and the final report. If the skill is not available, implement with these rules: read the whole plan including every `details`; respect every guardrail and stop to ask on "Ask first"; tick a criterion with `class="done"` only after running its check; report each criterion with the evidence that it passes.

For a handoff to another agent instead, use the `paseo-handoff` skill if available and point the receiving agent at the plan file and the `paseo-implement` skill; the plan is the briefing.

## Reference files

- `references/plan-template.html`: a complete M-sized plan. Copy its structure and its terseness.
- `references/html-subset.md`: the exact elements and classes the panel renders, the id rules, and the revision markers.
