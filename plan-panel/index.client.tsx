import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { PlanPanel } from "./client/plan-panel";
import { PLAN_PANEL_ID, PLANS_SCREEN_ID, createPlansScreen, plansScreenTitle } from "./client/plans-screen";

function PlansSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="ClipboardList"
      label="Plans"
      active={currentScreen?.screenId === PLANS_SCREEN_ID}
      onPress={() => openScreen({ screenId: PLANS_SCREEN_ID })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: PLAN_PANEL_ID,
    title: "Plan",
    icon: "ClipboardList",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: PlanPanel,
  });
  client.addScreen({
    id: PLANS_SCREEN_ID,
    title: plansScreenTitle,
    Component: createPlansScreen(client),
  });
  client.addSidebarHeaderItem({ id: "plans", title: "Plans", Component: PlansSidebarItem });
  client.addCommandCenterItem({
    id: "open-plan",
    title: "Open plan panel",
    icon: "ClipboardList",
    keywords: ["plan", "review", "comments", "feedback"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel(PLAN_PANEL_ID);
    },
  });
  client.addCommandCenterItem({
    id: "open-plans",
    title: "Open plans list",
    icon: "ClipboardList",
    keywords: ["plan", "plans", "review"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: PLANS_SCREEN_ID });
    },
  });
  client.addSlashCommand({
    name: "plan-panel",
    description: "Open the plan panel for this agent",
    argumentHint: "",
    context: "agent",
    onSubmit({ openPanel }) {
      openPanel(PLAN_PANEL_ID);
    },
  });
  return () => {};
}
