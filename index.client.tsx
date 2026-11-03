import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { SettingsScreen } from "./client/settings-screen";
import { UsageScreen } from "./client/usage-screen";

function UsageItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="ChartColumn"
      active={currentScreen?.screenId === "usage"}
      onPress={() => openScreen({ screenId: "usage" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "usage", title: "Token 用量", Component: UsageScreen });
  client.addSidebarHeaderItem({ id: "usage", title: "Token 用量", Component: UsageItem });
  client.addSettingsScreen({ id: "hub", title: "Token 用量", icon: "ChartColumn", Component: SettingsScreen });
  return () => {};
}
