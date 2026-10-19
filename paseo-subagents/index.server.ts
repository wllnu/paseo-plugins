import type { PluginServerContext } from "@getpaseo/plugin/server";
import { stop } from "./server/stop";
import { stopAgent } from "./shared/stop";

export default function contribute(server: PluginServerContext) {
  server.handle(stopAgent, stop);
  return () => {};
}
