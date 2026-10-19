import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { estimateContext } from "../shared/estimate.ts";
import { type TurnRecord, countActivity, turnRecord } from "../shared/stats.ts";
import { buildTrends, type contextTrends } from "../shared/trends.ts";
import { measureFixedParts } from "./fixed.ts";

const FILE = join(homedir(), ".paseo-context", "sessions.jsonl");

export async function recordTurn(
  { agent, turnId, outcome, timeline }: PluginLifecycleEvents["agent.turn_ended"],
  { paseo }: PluginHookContext,
) {
  const handle = paseo.agents.ref(agent.id);
  await handle.refresh();
  const estimate = estimateContext(timeline);
  const fixed = await measureFixedParts(handle.runtimeInfo);
  const record: TurnRecord = {
    at: new Date().toISOString(),
    agentId: agent.id,
    parentAgentId: agent.parentAgentId,
    workspaceId: agent.workspaceId,
    title: agent.title,
    cwd: agent.cwd,
    provider: agent.provider,
    model: handle.runtimeInfo?.model ?? handle.current()?.model ?? null,
    turnId,
    outcome: outcome.kind,
    ...countActivity(timeline),
    usage: handle.lastUsage,
    categories: Object.fromEntries(estimate.categories.map((c) => [c.category, c.tokens])),
    fixed: Object.fromEntries(fixed.map((part) => [part.label, part.tokens])),
    compacted: estimate.compacted,
  };
  await mkdir(dirname(FILE), { recursive: true });
  await appendFile(FILE, `${JSON.stringify(record)}\n`);
}

export function parseRecords(text: string) {
  const records: TurnRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const parsed = turnRecord.safeParse(JSON.parse(line));
      if (parsed.success) records.push(parsed.data);
    } catch {
      // A torn or hand-edited line; skip it.
    }
  }
  return records;
}

export async function readTrends(
  input: RpcInput<typeof contextTrends>,
): Promise<RpcOutput<typeof contextTrends>> {
  // lazy: reads the whole file on every call; index or tail it if it grows past a few MB.
  const text = await readFile(FILE, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return buildTrends(parseRecords(text), input);
}
