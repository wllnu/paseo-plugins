---
name: write-ruleset
description: Turns unformatted rules, guidelines, coding standards, or style guide documents into rulesets for the paseo-rules plugin, splitting them into single checkable rules with criteria and examples. Use when the user asks to convert, import, structure, or format rules or guidelines into a ruleset, wants rules added to a .rules folder, or mentions paseo-rules rulesets.
---

# Write a ruleset

A ruleset is one markdown file with two readers. A coding agent reads it before editing. A classifier then judges each changed file against it and answers, per rule, followed, violated, or not applicable. The classifier sees one file's diff. It cannot open other files or ask questions, so a rule only works when a diff alone settles it.

## Format

````md
---
id: ui
title: UI rules
paths: **/*.tsx, **/*.css
when: The change adds or edits user-facing components, styles, or layout.
---

## ui/theme-colors
Severity: error
Rule: Take every color from `theme.colors`.
Violated when: a style sets a color with a hex, rgb, or named literal.
Followed when: every color in the changed lines references a theme token.

Good:
```tsx
<Text style={{ color: theme.colors.foreground }}>Saved</Text>
```

Bad:
```tsx
<Text style={{ color: "#fff" }}>Saved</Text>
```
````

The parser is strict:

- Frontmatter is flat `key: value` lines. `id` is required and kebab-case. Always give a `title` and a `when` as well.
- `paths` is one line of comma-separated globs (`**`, `*`, `?`, `{a,b}`, no `!`). A glob without a slash matches at any depth. Leave `paths` out when the rules cover every file.
- Every `## ` heading starts a rule. Use no other `## ` headings.
- `Rule:`, `Violated when:` and `Followed when:` are required. Each value stays on one line.
- `Good:` and `Bad:` each sit alone on a line, followed by a fenced code block.
- Rule IDs are `<ruleset id>/<kebab-case-name>`. Never rename an existing ID.

## Process

1. Read the whole source document. Read the rulesets already in the target directory. Skip a guideline an existing rule already covers. When a new rule fits an existing ruleset, add it to that file and leave the rules already there unchanged.
2. Split. One rule is one decision a reviewer could make about a diff. "Use X and never Y" is two rules. Merge duplicates. Drop rationale, history, and advice that asks for nothing.
3. Sort each candidate.
   - A diff of one file settles it: keep it.
   - It needs another file, the running app, or the whole repository ("reuse existing helpers", "keep the bundle small"): leave it out.
   - It is too vague to decide ("write clean code", "keep functions small" with no number): leave it out. Do not invent a threshold the source does not give.
   - It contradicts another rule: leave both out.
4. Group the kept rules into rulesets by topic and file scope. All rules in a ruleset share `paths`, so rules for different file types go in different rulesets. Keep a ruleset to about a dozen rules, because every rule in it is asked about every matching file.
5. Write each rule, following the next section.
6. Save one file per ruleset as `<id>.md`. Project rules go in `.rules/` at the repository root, which is the default. Rules for every project go in the global rules directory, `~/.config/paseo-rules/` unless the plugin settings say otherwise. `.rules/` may hold only ruleset files.
7. Run `scripts/validate.ts` from this skill's folder and fix the files until it passes:
   `node --experimental-strip-types scripts/validate.ts <rules directory>`
8. Report the rulesets written with their rule counts. List every guideline you left out, quoted from the source, with the reason. Suggest AGENTS.md or CLAUDE.md for guidance that matters but cannot be checked. Name every assumption you made, such as a token name or a path the source did not give.

## Writing a rule

- `Rule:` is one imperative sentence that names the exact thing, such as an API, a token, or a pattern. Keep the source's meaning and strength. "Must" and "never" become `Severity: error`. "Should" and "prefer" become `Severity: warning`.
- `Violated when:` and `Followed when:` say what is visible in the changed lines. Write them in lower case so they complete "the rule is violated when". The classifier receives both lines word for word, so name the tokens it should look for. Avoid words that need an opinion, such as "properly", "clean", or "appropriate".
- `Bad:` breaks this rule and no other. `Good:` is the same code, fixed. Keep both under ten lines. Use names from the real codebase when the source or the repository shows them. Write the examples yourself when the source has none, because the plugin tests each rule against its own examples.
- `when:` is one sentence about the kind of change the ruleset covers. A coding agent reads it to decide whether to open the file, and the classifier reads it to decide whether a diff gets checked against the ruleset at all. Without it, the `paths` globs alone decide.

See [EXAMPLES.md](EXAMPLES.md) for a worked conversion.
