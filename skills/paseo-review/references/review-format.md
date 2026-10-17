# Review file format

The Paseo review panel reads `.paseo/reviews/*.json` in the workspace and polls for changes, so a rewritten file shows up within a couple of seconds. Files ending in `.state.json` belong to the panel (sent and dismissed flags); never write or delete them.

The panel validates the top level first, then each finding on its own. An invalid top level hides the whole review behind an error list; an invalid finding is skipped and listed under "problems in the review file", while the rest still show.

## Top level

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `version` | `1` | no | Format version. |
| `title` | string | yes | Shown as the panel title, e.g. `Review: upload retry branch`. |
| `createdAt` | ISO 8601 string | no | When the review was written. |
| `reviewer` | string | no | Who reviewed, e.g. `claude (paseo-review)`. |
| `verdict` | `approve` \| `changes-requested` \| `comment` | no | Overall call. |
| `summary` | string | no | 1 to 3 sentences. `path:line` references become links. |
| `scope` | object | yes | The reviewed diff, below. |
| `findings` | array | yes | May be empty. |

## `scope`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `base` | string | yes | Full commit SHA the diff starts from, ideally the merge-base. |
| `baseLabel` | string | no | Human name, e.g. `origin/main`. |
| `head` | string \| null | no | Full commit SHA the diff ends at. `null` or missing: the working tree, including untracked files. |
| `headLabel` | string | no | Human name, e.g. `feature/upload-retry`. |

Revisions may only contain letters, digits, and `. _ / @ ^ ~ { } -`, and must not start with `-`. Use SHAs: branch names move, and the line numbers stop matching.

## Findings

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | `B1…` blocking, `S1…` should-fix, `N1…` nits. Unique, stable, never renumbered. Letters, digits, `_`, `-`; at most 24 characters. |
| `severity` | `blocking` \| `should-fix` \| `nit` | yes | `nitpick`, `blocker`, and `should fix` are accepted and normalized. |
| `title` | string | yes | At most about 10 words. |
| `symptom` | string | for blocking and should-fix | What a user or caller notices, in plain language. |
| `detail` | string | yes | Cause and evidence, 1 to 4 sentences. |
| `fix` | string | no | Concrete suggestion. |
| `locations` | array | no | Where the finding is, most important first. Each opens the diff. |
| `resolution` | object \| null | no | Written by the fixing agent only, below. |

### `locations[]`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | string | yes | Workspace-relative path as git prints it. |
| `line` | integer | yes | First line, in the head version of the file (base version when `side` is `old`). |
| `endLine` | integer | no | Last line, inclusive. |
| `side` | `new` \| `old` | no | Default `new`. `old` points at lines the change deleted. |
| `note` | string | no | A few words shown on the location chip, e.g. `loop condition`. |

The diff view highlights `line` to `endLine`, scrolls to them, and shows the finding as an inline card after the last line. When those lines are outside the changed hunks it loads the whole file and says the lines are unchanged context. When the file is not in the diff at all, it shows the file as it is in `head`.

### `resolution`

| Field | Type | Notes |
| --- | --- | --- |
| `status` | `fixed` \| `wont-fix` | |
| `note` | string | What changed (with `file:line`) or why not. |
| `at` | ISO 8601 string | When. |

## References in text

In `summary`, `detail`, and `fix`:

- `path/to/file.ts:42` and `file.ts:42-48` become links into the diff. A bare file name links when exactly one finding location has a path ending in it.
- Text in backticks renders as code.
- Line breaks are kept. There is no other Markdown.
