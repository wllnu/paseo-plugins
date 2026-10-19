# Roadmap format

A roadmap breaks an approved plan into work packages that an orchestrator agent runs one at a time. For each package, a **scout** agent explores the code and writes a brief, then a **builder** agent implements that brief. The roadmap is the work order: it decides the cut, the order, and the boundaries. It does not decide code-level specifics; the scout works those out against the code as it is when the package starts.

## File

- Markdown at `.paseo/plans/<plan-slug>.roadmap.md`, next to the plan. Copy the structure of `roadmap-template.md`.
- The panel lists it beside the plan, renders the packages as a timeline with their status, takes comments on it, and shows a **Run** button.
- The panel parses a fixed shape, so keep to it: the headings, the `Status:` line, and `- Key: value` bullets below. Inline `code`, **bold**, and links are fine; tables and nested lists are not.

```markdown
# Roadmap: <plan title>

Plan: <plan file name>

<summary, at most 30 words: count, order, anything notable>

## Packages

### wp-1: <title, 1–3 words>
Status: open
- Goal: <what is true after the package; shown under the title>
- Covers: #step-1, #check-2
- Needs: <earlier packages; omit the line when none>
- Start from: <1–4 pointers: files, folders, symbols, a pattern to copy>
- Done when: <1–3 checks: commands or observable behavior>
- Not here: <tempting work that belongs elsewhere, with its owner>

## Run
- Checks: <commands that prove the repo is green>
- Scout: <profile name>
- Builder: <profile name>

## Risks
- <risk> → <mitigation>
```

Optional per package: `- Builder: <profile>` overrides the builder profile for an unusually small or large package. The orchestrator adds `- Blocked: <reason>` when it cannot finish a package.

## Before writing

1. Pressing **Break down** approves the plan: set its `plan-status` meta to `approved` first (no revision bump needed).
2. Read the whole plan, including every `details` block. Decisions and "Done when" bind every package.
3. Look at the code only enough to cut along real seams: the plan's changeset, module boundaries, test layout. Do not write briefs.
4. Find the checks that prove the repo is green (typecheck, lint, unit tests) from `package.json` scripts, a Makefile, or CI config.
5. If the Paseo tools are available, call `list_profiles` and name the scout and builder profiles in the Run section (default: profiles named Planner and Builder).

## Cutting packages

A good package has:

- **One outcome** a reviewer can name in a few words.
- **One builder session** of work: typically 1–6 files, a few hundred changed lines at most.
- **Its own proof**: "Done when" is a command the orchestrator can run or a behavior it can observe. Tests ship with the code they cover, not in a trailing "tests" package. Only cross-package end-to-end tests get their own package.
- **A green build afterwards**: typecheck and existing tests pass, even if the feature is not reachable yet.
- **No overlap**: each change belongs to one package. When two packages touch the same file, "Not here" says which part belongs to the other.

Order packages so each one needs only earlier ones, typically foundation → core logic → wiring → UI → end-to-end. Every plan step and check must be covered by at least one package; a step nothing covers goes under Risks as an open question.

Count: 2–12 packages. A plan that needs 2 packages or fewer does not need a roadmap; say so and offer to implement it directly. More than 12 means the plan is too big: propose splitting it.

Keep it short: fragments, no prose, each thing said once. About 2,000 bytes for 6 packages; at most 5,000 for 12.

## Status

Each package has one `Status:` line directly under its heading. The breakdown writes `open`; the orchestrator updates it during a run, and the panel shows it as the package's progress.

| Status | Meaning | Panel |
| --- | --- | --- |
| `open` | Not started | Plain number |
| `scouting` | Scout is writing the brief | Highlighted, "scouting" tag |
| `building` | Builder is implementing | Highlighted, "building" tag |
| `review` | Built and verified; the run pauses for the user | "review" tag, **Continue** button |
| `done` | Approved by the user | Tick |
| `blocked` | Stopped; reason in `- Blocked:` | Red, "blocked" tag |
| `skipped` | Dropped by the user | Muted |

## Revising

Roadmap feedback arrives as `[plan-panel feedback]` naming the roadmap file. Each comment names a package by id (`#wp-3`) or a section. Revise the file in place, plus:

- Keep the `Status:` lines of packages you do not change. A `done` package stays done unless the user wants it redone; then set it to `open`.
- Ids are `wp-N` and never renumber. An inserted package gets `wp-3b`; when packages merge, the survivor keeps its id. Packages run in document order, not id order.
- During an active run, the orchestrator re-reads the roadmap before each package, so changes to open packages take effect at the next one. Do not change a package that is `scouting`, `building`, or `review` unless the user asks.
