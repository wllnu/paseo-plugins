import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SubagentsPanel } from "./client/subagents";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "subagents",
    title: "Subagents",
    icon: "Bot",
    context: "workspace",
    locations: ["explorer"],
    Component: SubagentsPanel,
  });
  client.addCommandCenterItem({
    id: "open-subagents",
    title: "Open subagents",
    icon: "Bot",
    keywords: ["subagents", "agents", "explorer"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("subagents", { location: "explorer" });
    },
  });
  return () => {};
}
