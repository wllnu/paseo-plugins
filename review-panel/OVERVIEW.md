# Review panel

Shows the findings of an agent's code review in a workspace panel beside the agent, grouped into blocking, should fix, and nitpicks. Tick the findings you want fixed, add an optional note, and send them back to the agent in one message. Every finding lists the files and lines it is about; tap one to open a diff of that file scrolled to those lines, with the finding shown inline after them, the way review comments appear on a pull request.

## How it works

The panel reads review files that an agent writes to `.paseo/reviews/*.json` in the workspace, and refreshes within a couple of seconds when a file changes. A review records the exact commits it covers, so the diff view runs `git diff` on the daemon between those commits, or against the working tree for a review of uncommitted changes. Lines outside the changed hunks are still shown: the panel loads the whole file and says the lines are unchanged context. A file that is not part of the diff is shown as it is in the reviewed commit. Removed code can be referenced by its old line numbers. Code is syntax-highlighted on the daemon with the same highlighter and colors as Paseo's own diff view.

File references written in a finding's text, such as `retry.ts:42` or `src/upload/retry.ts:42-48`, are links into the same diff view. Each finding shows whether it was sent, dismissed, or resolved; the agent marks findings fixed or won't fix in the review file after working on them. Sent and dismissed flags are stored next to the review in `<review>.state.json`.

On a wide panel the findings list and the diff sit side by side; on narrow windows and mobile the diff opens over the list with a back link. Several reviews in one workspace appear as tabs, newest first.

## Setup

Pair it with the `paseo-review` agent skill, which reviews a change, classifies and locates each finding, writes the review file in the format the panel reads, and fixes the findings you send back. Open the panel from the workspace tab bar, the Command Center (Open review panel), or the `/review-panel` composer command. The panel is an agent panel: findings you send go to the agent it is open beside. The workspace must be a git repository with the reviewed commits available locally.

## Limits

Sending findings to an agent that is in the middle of a turn interrupts that turn; the send dialog warns about this. The diff view shows one file at a time and at most 4000 lines of it. Line numbers come from the review file, so they are only as accurate as the reviewing agent made them.
