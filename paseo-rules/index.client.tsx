import type { PluginClientContext } from "@getpaseo/plugin/client";
import { RulesPanel } from "./client/panel";
import { JudgeSettings } from "./client/settings";
import { runReview } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings("judge");
  client.addWorkspacePanel({
    id: "rules",
    title: "Rules",
    icon: "ListChecks",
    context: "workspace",
    locations: ["explorer"],
    Component: (props) => <RulesPanel {...props} openSettings={openSettings} />,
  });
  client.addSettingsScreen({
    id: "judge",
    title: "Rules",
    icon: "ListChecks",
    Component: JudgeSettings,
  });
  client.addCommandCenterItem({
    id: "open-rules-settings",
    title: "Open rules settings",
    icon: "ListChecks",
    keywords: ["rules", "judge", "key", "settings"],
    context: "global",
    onSelect: openSettings,
  });
  client.addCommandCenterItem({
    id: "open-rules",
    title: "Open rules check",
    icon: "ListChecks",
    keywords: ["rules", "review", "check", "explorer"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("rules", { location: "explorer" });
    },
  });
  client.addCommandCenterItem({
    id: "check-rules",
    title: "Check rules now",
    icon: "ListChecks",
    keywords: ["rules", "review", "check", "judge"],
    context: "agent",
    async onSelect({ agent, rpc, openPanel }) {
      await rpc(runReview, { agentId: agent.id });
      openPanel("rules", { location: "explorer" });
    },
  });
  return () => {};
}
