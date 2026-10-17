import type { PluginServerContext } from "@getpaseo/plugin/server";
import { computeFileDiff } from "./server/git";
import { listReviews, readReview, readState, writeState } from "./server/reviews";
import { fileDiffRpc, listReviewsRpc, readReviewRpc, readStateRpc, writeStateRpc } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  server.handle(listReviewsRpc, listReviews);
  server.handle(readReviewRpc, readReview);
  server.handle(readStateRpc, readState);
  server.handle(writeStateRpc, writeState);
  server.handle(fileDiffRpc, computeFileDiff);
  return () => {};
}
