import { PLAN_DIR } from "./contracts";
import type { HtmlElement, HtmlNode } from "./html";

/**
 * A plan ends in "Done when": a `ul.checks` of criteria. The agent that implements the plan ticks each one with
 * `class="done"` once its check passes (`doing` while it works on it), so the criteria double as progress.
 */
export interface PlanProgress {
  total: number;
  done: number;
  doing: number;
}

function classes(element: HtmlElement): Set<string> {
  return new Set((element.attrs.class ?? "").split(/\s+/).filter(Boolean));
}

/** Counts the items of every `ul.checks` in the plan. */
export function readProgress(body: HtmlElement): PlanProgress {
  const progress: PlanProgress = { total: 0, done: 0, doing: 0 };
  const visit = (node: HtmlNode) => {
    if (node.type !== "element") return;
    if (node.tag === "ul" && classes(node).has("checks")) {
      for (const child of node.children) {
        if (child.type !== "element" || child.tag !== "li") continue;
        const status = classes(child);
        progress.total += 1;
        if (status.has("done")) progress.done += 1;
        else if (status.has("doing")) progress.doing += 1;
      }
      return;
    }
    node.children.forEach(visit);
  };
  visit(body);
  return progress;
}

export interface ImplementPromptInput {
  planName: string;
  planTitle: string;
  revision: string | null;
  /** Comments the user left in the panel but did not send; the agent asks whether they should count. */
  unsentComments: number;
}

/** Sent to the agent beside the panel. Pressing Implement approves the plan. */
export function buildImplementPrompt({ planName, planTitle, revision, unsentComments }: ImplementPromptInput): string {
  const revisionLabel = revision ? ` (revision ${revision})` : "";
  const lines = [
    `[plan-panel implement] I approve the plan "${planTitle}"${revisionLabel}. Implement it.`,
    `Plan file: ${PLAN_DIR}/${planName}`,
    "",
    "Follow the paseo-implement skill. Set plan-status to approved, then work until every \"Done when\" criterion passes its check, and show me the evidence. Respect the guardrails: stop and ask me before anything under \"Ask first\", and never do anything under \"Never\". Launch subagents where the work splits into independent parts or needs broad exploration, and verify their results yourself.",
    "Tick criteria in the plan and keep the progress log current so the plan panel shows where you are. Do not commit; leave the changes in the working tree for my review.",
  ];
  if (unsentComments > 0) {
    lines.push(
      "",
      `I have ${unsentComments === 1 ? "1 unsent comment" : `${unsentComments} unsent comments`} in the panel. Ask me whether to address ${unsentComments === 1 ? "it" : "them"} before you start.`,
    );
  }
  return lines.join("\n");
}
