import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listPlans, readComments, readPlan, writeComments } from "./server/plans";
import { listPlansRpc, readCommentsRpc, readPlanRpc, writeCommentsRpc } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  server.handle(listPlansRpc, listPlans);
  server.handle(readPlanRpc, readPlan);
  server.handle(readCommentsRpc, readComments);
  server.handle(writeCommentsRpc, writeComments);
  return () => {};
}
