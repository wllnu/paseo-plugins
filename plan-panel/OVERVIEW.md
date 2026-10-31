# Plan panel

Shows the HTML plan an agent wrote for its task in a workspace panel beside the agent, and lets you comment on any part of it. A thin comment rail runs down the right side of the plan with one handle per heading, paragraph, step, table row, or code block. Click handles to select one or more blocks (shift-click selects a range), then press Comment to attach one comment to all of them. The plan itself stays fully interactive: clicking inside it expands details, follows links, and selects text, but never starts a comment. Select a passage with the mouse and press the floating Comment on selection button to comment on exactly that text, even across several blocks. Add a general comment for the plan as a whole. When you are done, send all pending comments to the agent in one message. Each comment arrives with its location in the plan: the heading breadcrumb, the element id, the position, and either a quote of each selected block or the exact text you highlighted.

## How it works

The panel reads `.paseo/plans/*.html` inside the workspace directory and refreshes when the file changes, so an agent that rewrites the plan updates the panel within a couple of seconds. Comments are stored next to the plan in `<plan>.comments.json`, so they survive closing the tab and are visible to the agent on disk as well. Elements marked `data-revised` with the current plan revision are labelled as updated. Comment counts show as badges in the rail; a fact row, a flow diagram, and a callout have one handle each, since their parts sit side by side.

Plans are rendered natively from a documented HTML subset: headings, paragraphs, lists, tables, code blocks, quotes, links, and inline formatting. Scripts, styles, and images are ignored. On top of that, a few `class` names turn plain elements into visuals: fact chips, flow diagrams, a step timeline with progress, checklists, file changesets, side-by-side comparisons, callouts, and status tags. `details` blocks are collapsed by default, so a plan can keep implementation specifics for the agent without burying the overview, and a collapsed block shows how many comments it hides. The panel works on desktop, web, and mobile clients. Text selection comments are available on desktop and web; on mobile, tap the rail to select blocks.

## From plan to running code

A plan has three parts: the task (what will be true when it is done, with the decisions already made), guardrails (what the agent should always do, ask about first, or never do), and the definition of done (criteria that each pass or fail by a check). There are no implementation steps; the implementing agent reads the code and picks the order itself.

Once the plan looks right, press **Implement** in the panel header. That approves the plan and asks the agent beside the panel to implement it. The agent works until every criterion in "Done when" passes its check, launching subagents where the work splits into independent parts, and stops to ask before anything under "Ask first". Progress shows live in the plan: the criterion being worked on is highlighted, verified ones are ticked, the header counts criteria done, and a Progress log at the end records what was verified, deviations, and questions. When everything passes, the agent reports each criterion with its evidence. Nothing is committed: all changes stay in the working tree for you to review.

## Setup

Pair it with the `paseo-plan` agent skill, which interviews you about the request, writes the plan in the supported format, and revises it from the panel's feedback, and the `paseo-implement` skill, which the agent follows after you press Implement. Open the panel from the Command Center (Open plan panel), the `/plan-panel` composer command, or the workspace tab bar. The panel is an agent panel, so it needs an agent selected to know where to send feedback.

A Plans entry in the sidebar lists every plan across your workspaces, newest first, and opens any of them as a full screen with the same commenting and send flow. Feedback goes to the workspace's most recently active agent; a workspace without an active agent shows the plan read-only. Reorder or hide the entry under Settings → Sidebar.

## Limits

The plan must be a file in the workspace; the panel does not fetch URLs. Comments map to elements by `id`, or by position when an element has no id, so plans that keep their ids stable across revisions keep the comment badges in place.
