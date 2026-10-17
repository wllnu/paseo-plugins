# HTML subset rendered by the Paseo plan panel

The panel renders plans natively (no browser engine), so only the elements below are drawn. Anything else keeps its text but loses structure. Scripts, styles, SVG, iframes, and images are ignored (images show their `alt` text).

Visual components are plain HTML elements with a `class`. The class list below is the whole vocabulary; any other class is ignored.

## Document frame

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Plan: Short title</title>
<meta name="plan-revision" content="1">
<meta name="plan-status" content="review">
</head>
<body>…</body>
</html>
```

- `title` is shown in the panel header. Prefix it with `Plan:`.
- `plan-revision` is an integer you bump on every revision. The panel shows it and uses it to label updated elements.
- `plan-status` is one of `draft`, `review`, `approved`.
- No indentation: whitespace costs characters and the panel ignores it. One block per line; short pairs such as `<dt>…</dt><dd>…</dd>` may share a line.

## Visual components

| Markup | Renders as | Use for |
| --- | --- | --- |
| `<ul class="facts"><li><b>Size</b> M</li>…</ul>` | A row of chips, label muted, value bold | Key numbers under the summary: size, files, risk, new parts |
| `<ol class="flow"><li><b>Worker</b> emits event</li>…</ol>` | Boxes joined by arrows: one row when wide, stacked when narrow | Data flow, request path, user journey; 3–6 boxes |
| `<ol class="steps"><li><strong>Title</strong> caption …</li></ol>` | Numbered timeline, title over a muted caption | Implementation steps |
| `<ul class="checks"><li>…</li></ul>` | Checkboxes | Acceptance criteria ("Done when") |
| `<ul class="files"><li>+ src/a.ts</li><li>~ src/b.ts</li><li>- src/c.ts</li></ul>` | Monospace changeset, `+` green, `~` amber, `-` red | Files added, changed, removed |
| `<div class="compare"><div>…</div><div>…</div></div>` | Side-by-side columns, stacked when narrow | In/out of scope, before/after, two or three options |
| `<dl><dt>Label</dt><dd>Value</dd></dl>` | Two-column rows, label muted on the left | Decisions, settings, mappings |
| `<aside class="ask"><p>…</p></aside>` | Tinted callout with an icon | A blocking question, a warning, a key note |
| `<details><summary>Label</summary>…</details>` | Collapsed by default behind a `›` toggle; `Details` when there is no `summary` | The detail layer: specifics only the implementer needs |
| `<span class="tag">assumed</span>` | Small tinted label inside text | Status words: assumed, new, breaking, optional |

The title of a `flow` box, a `steps` item, and a `facts` chip is the leading `<strong>` or `<b>`; everything after it is the caption or value. Do not add punctuation between them.

### Modifier classes

Put these on the element itself, combined with the components above:

| Class | On | Effect |
| --- | --- | --- |
| `ok` | `li`, column, chip, `aside`, `span` | Green ✓ (done, in scope, good) |
| `no` | same | Muted ✕ (out of scope, rejected) |
| `warn` | same | Amber ! (medium risk, caveat) |
| `risk` | same | Solid red ! (high risk, breaking) |
| `ask` | same | Accent ? (open question for the user) |
| `note` | same | Muted i (side note); also the default for `aside` |
| `chosen` | `li`, `tr`, column, `dt`/`dd` | Highlighted as the selected option |
| `done`, `doing` | `li` in `steps` or `checks` | Progress: ✓ filled or highlighted. Use during implementation |

On a list item a tone replaces the bullet with its icon. On a `compare` column it colors the column's top edge. On a `steps` item it colors the number.

## Plain blocks

Each of these is one unit the user can select in the panel's comment rail and comment on, alone or together with others. A `facts` row, a `flow`, and an `aside` are selected as one unit each:

| Element | Rendered as |
| --- | --- |
| `h1` … `h6` | Headings. `h2` for sections, `h4` for column titles. They form the breadcrumb reported with comments. |
| `p` | Paragraph. |
| `li` | List item. Nested lists inside it are separate units. |
| `pre` | Code block, whitespace preserved: `<pre><code>…</code></pre>`. |
| `tr` | Table row. Cells are `th` or `td`. |
| `blockquote` | Indented quote. |
| `hr` | Divider (not selectable). |

Containers: `section`, `header`, `div`, `article`, `main`, `figure`. The `header` gets a divider below it.

## Inline formatting

`strong`/`b`, `em`/`i`, `code`/`kbd`, `a href="https://…"` (opens externally), `br`, `mark`, `del`/`s`, `small`, `sub`, `sup`, `span`.

Escape `<`, `>`, and `&` in text as `&lt;`, `&gt;`, `&amp;`. Named entities such as `&mdash;` and numeric entities are decoded.

## Ids

- Every `section`, step, check, scope item, decision, risk, question, and option row gets a short, stable, kebab-case id: `goal`, `step-3`, `check-2`, `scope-in-1`, `decision-2`, `risk-1`, `question-1`, `option-queue`. In a `dl`, put the id on the `dt`. Chips, flow boxes, and items inside `details` need no id.
- Never renumber or rename ids in a revision. Append new ids (`step-3b`, `step-8`). When elements merge, keep the survivor's id and delete the other. Delete elements that are gone.
- Comments are matched to elements by id, so stable ids keep the user's comment badges attached to the right place. Elements without an id are matched by position, which shifts when you insert content above them.

## Revisions

- Bump `plan-revision` on every rewrite.
- Add `data-revised="<new revision>"` to every element you changed or added. The panel labels those "updated", and opens any `details` that contains one so the change is not hidden. Remove stale `data-revised` attributes from elements you did not touch in this revision, or leave them; only the current revision is highlighted.

## Do not use

- `<style>`, `style="…"`, `<script>`, `<img>` for content, `<iframe>`, `<svg>`, `<form>` controls, classes outside the vocabulary above.
- HTML comments for plan content. The panel drops them, so the user never sees them and cannot comment on them. Put implementer detail in `details` instead.
- Markdown. The file must be HTML.
- Lists nested deeper than two levels; split into sections instead.
