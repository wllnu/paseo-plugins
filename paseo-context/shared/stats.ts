import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { z } from "zod";

/** One finished turn, as appended to ~/.paseo-context/sessions.jsonl. */
export const turnRecord = z.object({
  at: z.string(),
  agentId: z.string(),
  parentAgentId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  title: z.string().nullable(),
  cwd: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  turnId: z.string().nullable(),
  outcome: z.enum(["completed", "failed", "canceled"]),
  turns: z.number(),
  toolCalls: z.number(),
  toolCallsByName: z.record(z.string(), z.number()),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      cachedInputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      totalCostUsd: z.number().optional(),
      contextWindowMaxTokens: z.number().optional(),
      contextWindowUsedTokens: z.number().optional(),
    })
    .nullable(),
  /** Estimated tokens per timeline category, keyed by `Category`. */
  categories: z.record(z.string(), z.number()),
  /** Estimated tokens per fixed part (system prompt, tools, memory); Claude agents only. */
  fixed: z.record(z.string(), z.number()),
  compacted: z.boolean(),
});

export type TurnRecord = z.infer<typeof turnRecord>;

/** Turns and tool calls over the whole session, compactions included. */
export function countActivity(items: readonly AgentTimelineItem[]) {
  let turns = 0;
  const calls = new Map<string, string>();
  for (const item of items) {
    if (item.type === "user_message") turns++;
    else if (item.type === "tool_call") calls.set(item.callId, item.name);
  }
  const toolCallsByName: Record<string, number> = {};
  for (const name of calls.values()) toolCallsByName[name] = (toolCallsByName[name] ?? 0) + 1;
  return { turns, toolCalls: calls.size, toolCallsByName };
}
