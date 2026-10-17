---
name: paseo-plan
description: Refine a request through a sized interview, then write an HTML plan to .paseo/plans/ that the Paseo plan panel renders, and revise it from the panel's comments. Use when the user asks to plan, spec, scope, design, or refine a feature or change before building it, says "make a plan", "plan this", "let's plan", "/paseo-plan", or when a message starts with "[plan-panel feedback]".
user-invocable: true
argument-hint: "<what to plan>"
---

# Paseo plan

Turn a rough request into a plan the user can review and annotate in the Paseo **Plan** panel. The flow is a refinement session: interview first, then write the plan as HTML, then revise it from the comments the user sends back from the panel. Do not implement anything until the user approves the plan.

**User's request:** $ARGUMENTS

## The flow

1. **Size the request** and pick an interview budget.
2. **Interview** the user in batched rounds until the open questions are closed.
3. **Write the plan** to `.paseo/plans/<slug>.html` using the template and HTML subset in `references/`.
4. **Hand the plan to the user** and stop.
5. **Revise** when `[plan-panel feedback]` arrives. Repeat until the user approves.
6. **Hand off** to implementation.

If a message starting with `[plan-panel feedback]` arrives, skip to step 5.

## Step 1: Size the request

Look at the codebase before asking anything. Find the files the request touches, the existing patterns, tests, and anything that already does part of the job. Questions the code can answer are never asked.

Then size the request:

| Size | Typical shape | Interview budget |
| --- | --- | --- |
| XS | One file, obvious change, no product decision | 0–1 questions, or none; confirm your reading in one sentence and go to the plan |
| S | A few files, one clear feature, few branches | 1 round, 2–4 questions |
| M | New component, API, or workflow; several ways to do it | 2 rounds, 4–8 questions total |
| L | Cross-cutting change, migration, new subsystem, or unclear goal | 2–4 rounds, 8–15 questions total, with a written summary between rounds |

Size on uncertainty, not on effort. A large but fully specified task is S. A small task whose purpose is unclear is M.

Tell the user the size in one line before the first round, for example: "This is a medium-sized change, I have 5 questions before I write the plan."

## Step 2: Interview

Interview like a product refinement session: the goal is a shared understanding of *what* and *why*, and the decisions that shape *how*.

Cover, in this order of priority, skipping anything already clear:

1. **Outcome.** What should be true when this is done? Who benefits?
2. **Boundaries.** What is explicitly out of scope? What must not change?
3. **Decisions with alternatives.** Where there are two or more sensible designs, present them with a recommendation and a one-line trade-off each.
4. **Constraints.** Compatibility, performance, security, deadlines, dependencies, rollout.
5. **Acceptance.** How will the user verify the result? What would make them reject it?
6. **Unknowns you found in the code.** Dead code, conflicting patterns, missing tests that change the plan.

Rules:

- Ask in **batched rounds**, never one question at a time. Stay within the budget per round.
- Every question states **why it matters** in a few words and offers a **recommended default** when you have one. The user should be able to answer "defaults are fine".
- Prefer **closed questions** with options. Use the `AskUserQuestion` tool when it is available; otherwise write a numbered list and wait.
- Never ask what you can read from the code, the git history, or the conversation.
- After each round, **restate the decisions** in one short list before asking the next round or writing the plan.
- Stop when the remaining uncertainty would not change the plan's steps. Do not interview for completeness.
- If the user says "just plan it" or answers with defaults, stop asking and write the plan under stated assumptions. Put the assumptions in the plan's **Decisions** section marked as assumptions.

## Step 3: Write the plan

Read `references/plan-template.html` and `references/html-subset.md` before writing. The panel renders a fixed HTML subset natively, plus a small set of visual components selected with `class`; anything outside it loses structure.

**Location and naming**

- Write to `.paseo/plans/<slug>.html` relative to the workspace root (your working directory). Create the directory if needed.
- `<slug>` is kebab-case from the title, for example `notify-on-upload-finish.html`. One plan per request. Keep the same file across revisions.
- Keep the file out of commits unless the user asks for it. If the repository does not ignore `.paseo/`, append `.paseo/` to `.git/info/exclude` (local only, not `.gitignore`).

**Two layers**

A plan has two readers. The user reviews it in a narrow side panel and should grasp it in about a minute. You, or another agent, implement from it later and need every specific. Write both into the same file:

- **Glance layer** (visible): summary, facts, flow, step titles, scope columns, risks, decisions. Show structure with components, not prose. Visible items are short fragments, never paragraphs (word limits under **Writing rules**).
- **Detail layer** (inside `<details>`, collapsed by default): file paths, function names, signatures, commands, thresholds, edge cases, test names. It costs the reader nothing until they open it, but it is part of the plan: the user can expand it and comment on it, and it is binding during implementation.

Sort each fact with one test: would the user want to see or change it while reviewing? Then it is visible. If only the implementer needs it (paths, versions, URL lists, commands, thresholds), it goes into `<details>`. A `details` can sit inside any item that has specifics, such as a step, a `dd`, or a risk, and below a section's visuals.

**Sections**

In this order; drop a section only when it would be empty:

| Section | Glance layer | Typical detail layer |
| --- | --- | --- |
| `header` | `h1`; `p id="summary"`, one or two sentences, at most 40 words; `ul class="facts"`, 3–5 chips; one `aside class="ask" id="question-N"` per open question that blocks approval | — |
| `goal`, heading "Done when" | `ul class="checks"`, 2–5 items `check-N` the user can verify | `details` "How to verify": steps and commands |
| `scope` | `div class="compare"`: an `ok` column "In", a `no` column "Out" | — |
| `approach` | `ol class="flow"` with 3–6 boxes showing how it works; alternatives as a table with a `chosen` row, or `compare` columns with a `chosen` column; at most two short `p` | `details` "Files (N)" holding a `ul class="files"` changeset; an interface in `pre` when the interface is the decision |
| `steps` | `ol class="steps"`, items `step-N`: `<strong>Title</strong>` plus a caption of at most 8 words | a `details` inside each step that needs specifics (no `summary`; the panel labels it "Details") |
| `risks` | `li` with `warn` or `risk`, ids `risk-N`, written as "risk → mitigation"; open questions that block only a later step as `li class="ask" id="question-N"`, naming the step | a `details` inside a risk whose mitigation needs a command or setting |
| `decisions` | `dl`: `dt id="decision-N"` short label, `dd` the answer | a `details` inside a `dd` for long specifics (version pins, URL lists) |

Section rules:

- **Facts** are facts or your own assessment, never invented: Size (from Step 1), Files (count of the changeset), Risk (from the highest tone in Risks: none is low, `warn` is medium, `risk` is high, with the matching class on the chip), New (parts that do not exist yet). One to three words per chip.
- **Questions** are only open ones. A question the interview answered becomes a decision and disappears.
- **Decisions** stay visible, because the user made them, but compact: at most about 12 rows. Group related decisions under one label (for example "Tooling") with the specifics in a `details` inside the `dd`. An option marked `chosen` in the approach is the record of that decision; do not repeat it as a `dt`. Mark assumptions with `<span class="tag">assumed</span>` placed right after the assumed part.
- **Phases.** For L plans, group steps under one `h3` per phase, each followed by its own `ol class="steps"` with `start` continuing the numbering. The step budget counts all phases together:

```html
<h3>Foundation</h3>
<ol class="steps">
<li id="step-1"><strong>Scaffold</strong> app, lint, hooks</li>
</ol>
<h3>Pages</h3>
<ol class="steps" start="2">
<li id="step-2"><strong>Landing page</strong> every module type</li>
</ol>
```

**Budgets**

| Size | Steps | Visible items | Whole file |
| --- | --- | --- | --- |
| XS/S | ≤ 5 | ≤ 25 | ≤ 4,000 bytes |
| M | ≤ 8 | ≤ 40 | ≤ 7,000 bytes |
| L | ≤ 12 | ≤ 60 | ≤ 12,000 bytes |

Visible items are every `li`, `p`, `tr` (header rows included), and `dt` outside a `details`; chips and flow boxes count. Measure the file with `wc -c`.

The two budgets fail for different reasons and have different fixes:

- **Too many visible items:** the glance layer carries detail. Move specifics into `details`, group decisions, merge steps.
- **Too many bytes:** the detail layer is wordy. Cut rationale and evidence (why something was chosen, how you checked it), repeated paths, optional ids, and filler; write fragments. Moving text into `details` does not save bytes.

Never drop a specific the implementer needs to meet a budget. If the file is still slightly over after cutting, that is acceptable. If it is far over (about 25 % or more), the request is too big for one plan: tell the user and propose splitting it into separate plans.

**Writing rules**

- Say each thing once. The summary, "Done when", flow, and steps each have their own job. Decisions are not restated in the approach.
- The `files` changeset is the only full list of paths. A step's details may name a path where a specific needs it ("`markRead` in `src/notifications/service.ts`"), but steps do not get their own file lists.
- Prefer a component over a paragraph: a sequence is a `flow` or `steps`, a comparison is `compare` or a table, attributes are `facts` or a `dl`, a status is a tone class or a tag.
- Statements in lists (checks, scope items, risks) are fragments of about 4–12 words; titles, chips, and captions are shorter. No filler ("This step will…", "We need to…").
- In the glance layer, use `code` only for names the user must recognize, such as the one command they run to verify. Other paths, signatures, and commands belong in `details`.
- Tables: at most 3 columns, cells of a few words. The panel is narrow.
- The detail layer is terse too: fragments, no prose, no pasted code beyond a short interface.
- No indentation. One block per line; short pairs such as `<dt>…</dt><dd>…</dd>` may share a line.

**Metadata**

- `<title>Plan: …</title>`
- `<meta name="plan-revision" content="1">`, bump on every revision
- `<meta name="plan-status" content="review">`; `draft` while writing, `review` when handed over, `approved` after the user approves

**Ids**

Give an id to every section, step, check, scope item, decision, risk, question, and option row. Other elements (chips, flow boxes, items inside `details`) need none; comments on them are matched by position. Ids are how the panel attaches comments and how feedback refers back to the plan.

- A new plan numbers ids from 1 in document order.
- A revision never renumbers. New elements get new ids (`step-3b`, `step-13`). When two elements merge, the survivor keeps its id and the other is deleted; update any cross-reference such as `#step-14` that pointed at it.
- The panel numbers steps by position, so gaps in id numbers are invisible to the user.

## Step 4: Hand the plan to the user

After writing the file, send one short message:

- Where the plan is and how to open it: the **Plan** tab in the workspace, **Plans** in the sidebar, the Command Center item **Open plan panel**, or `/plan-panel` in the composer.
- The two or three decisions most worth a second look.
- That you will wait for comments from the panel or an approval.

Then stop. Do not start implementing. Do not paste the plan into the chat; the panel is the review surface. If the user says they cannot see the panel, tell them the `plan-panel` plugin needs to be installed and running in Paseo (Settings → Plugins).

## Step 5: Revise from panel feedback

Feedback arrives as a message that starts with `[plan-panel feedback]` and lists numbered comments. Each comment carries:

- **Where:** a heading breadcrumb, the element kind, and the element id (`#step-3`) or the anchor it sits inside (`inside #scope`). A highlighted range that spans blocks reads `from … to …`.
- **Quote:** the text of the element the user selected, or
- **Selected:** the exact passage the user highlighted with the mouse. Treat a selected passage as the precise target: change that wording or that part of the step, not the whole element, unless the comment says otherwise.
- **Comment:** the user's note.

The user can select several elements for one comment. Then **Where** reads `N blocks` and is followed by one `- <location>: "<quote>"` line per element. The comment applies to all of them together, for example "merge these" or "same problem in each". A `facts` row, a `flow`, and an `aside` are selected as a whole and are reported as `fact chips`, `flow`, and `callout`.

A comment with **Where: whole plan** is about the plan overall.

Procedure:

1. Read the current plan file; the panel may be ahead of your memory of it.
2. For each comment, locate the element by id first, then by breadcrumb and quote. Decide what changes: the element itself, its section, or the whole approach.
3. If a comment is ambiguous or conflicts with an earlier decision, ask about that comment specifically before changing the plan. Apply the unambiguous ones in the same turn.
4. Rewrite the file in place: keep ids stable, bump `plan-revision`, add `data-revised="<new revision>"` to every element you changed or added, remove or rewrite anything the feedback invalidated, and update **Decisions** with what the feedback decided.
5. Reply with a numbered list mirroring the comment numbers: one line per comment saying what changed and where (`#step-3`). Mention anything you chose not to change and why.

When the user approves (in the panel feedback or in chat), set `plan-status` to `approved`, bump the revision, and move to step 6.

## Step 6: Hand off

Ask how the user wants to proceed if it is not already clear: implement it yourself now, or hand off to another agent. For a handoff, use the `paseo-handoff` skill if available and point the receiving agent at the plan file; the plan is the briefing. Read the whole file before starting, including every `details` block: the detail layer is where the specifics live.

While implementing, keep the plan honest so the panel shows progress:

- Mark the step you are on with `class="doing"` and finished steps with `class="done"`; tick met criteria in "Done when" with `class="done"`. These edits do not need a revision bump.
- When reality forces a change to a step, update the plan file, bump the revision, and mark the change with `data-revised` so the panel stays the source of truth.

## Reference files

- `references/plan-template.html`: a complete M-sized plan using every component. Copy its structure and its terseness.
- `references/html-subset.md`: the exact elements and classes the panel renders, the id rules, and the revision markers.
