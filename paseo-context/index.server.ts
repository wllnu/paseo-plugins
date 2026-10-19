import type { PluginServerContext } from "@getpaseo/plugin/server";
import { measureFixedContext } from "./server/fixed";
import { readTrends, recordTurn } from "./server/stats";
import { fixedContext } from "./shared/fixed";
import { contextTrends } from "./shared/trends";

export default function contribute(server: PluginServerContext) {
  server.handle(fixedContext, measureFixedContext);
  server.handle(contextTrends, readTrends);
  server.on("agent.turn_ended", recordTurn);
  return () => {};
}
