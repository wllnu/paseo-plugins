import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { ContextPanel } from "./client/context";
import { Dashboard } from "./client/dashboard";

function TrendsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="ChartColumn"
      active={currentScreen?.screenId === "trends"}
      onPress={() => openScreen({ screenId: "trends" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "context",
    title: "Context",
    icon: "Gauge",
    context: "workspace",
    locations: ["explorer"],
    Component: ContextPanel,
  });
  client.addScreen({ id: "trends", title: "Context trends", Component: Dashboard });
  client.addSidebarHeaderItem({ id: "trends", title: "Context trends", Component: TrendsItem });
  client.addCommandCenterItem({
    id: "open-context",
    title: "Open context",
    icon: "Gauge",
    keywords: ["context", "tokens", "usage", "explorer"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("context", { location: "explorer" });
    },
  });
  client.addCommandCenterItem({
    id: "open-context-trends",
    title: "Open context trends",
    icon: "ChartColumn",
    keywords: ["context", "tokens", "trends", "models", "dashboard"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "trends" });
    },
  });
  return () => {};
}
