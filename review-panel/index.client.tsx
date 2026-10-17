import type { PluginClientContext } from "@getpaseo/plugin/client";
import { REVIEW_PANEL_ID, ReviewPanel } from "./client/review-panel";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: REVIEW_PANEL_ID,
    title: "Review",
    icon: "SearchCheck",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: ReviewPanel,
  });
  client.addCommandCenterItem({
    id: "open-review",
    title: "Open review panel",
    icon: "SearchCheck",
    keywords: ["review", "findings", "code review", "diff", "blocking", "nit"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel(REVIEW_PANEL_ID);
    },
  });
  client.addSlashCommand({
    name: "review-panel",
    description: "Open the review panel for this agent",
    argumentHint: "",
    context: "agent",
    onSubmit({ openPanel }) {
      openPanel(REVIEW_PANEL_ID);
    },
  });
  return () => {};
}
