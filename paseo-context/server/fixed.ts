import { createReadStream } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { type ContextItem, estimateTokens, firstLine, sumTokens } from "../shared/estimate.ts";
import type { fixedContext } from "../shared/fixed";

// Transcript attachment types that Claude Code renders into the context, grouped for display.
// Anything else it renders (date, environment, reminders) lands in OTHER.
const ATTACHMENT_LABELS: Record<string, string> = {
  instructions: "Memory files",
  skill_listing: "Skills list",
  agent_listing_delta: "Subagent types",
  deferred_tools_delta: "MCP and deferred tools",
  mcp_instructions_delta: "MCP server instructions",
};
const TITLES: Record<string, string> = {
  skill_listing: "Skill names and descriptions",
  agent_listing_delta: "Subagent type descriptions",
  deferred_tools_delta: "Tool names announced to the agent",
  mcp_instructions_delta: "Instructions from MCP servers",
};
const SYSTEM_PROMPT = "System prompt";
const TOOLS = "Built-in tools";
const OTHER = "Environment and reminders";

// lazy: each item's text is cut to this many characters to keep the RPC reply small.
// Upgrade path: a second RPC that returns one item's full text on demand.
const MAX_ITEM_TEXT = 8000;

function item(title: string, text: string): ContextItem {
  return {
    title: firstLine(title),
    text: text.slice(0, MAX_ITEM_TEXT),
    tokens: estimateTokens(text.length),
  };
}

function text(value: unknown) {
  if (typeof value === "string") return value;
  return value == null ? "" : JSON.stringify(value, null, 2);
}

function renderedText(rendered: unknown) {
  if (!Array.isArray(rendered)) return "";
  return rendered
    .map((block) => (typeof block?.content === "string" ? block.content : ""))
    .join("\n");
}

async function findTranscript(sessionId: string) {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  for (const project of await readdir(projects).catch(() => [])) {
    const file = join(projects, project, `${sessionId}.jsonl`);
    if (await access(file).then(() => true, () => false)) return file;
  }
  return null;
}

// lazy: reads Claude Code's private transcript format, which can change between releases;
// unknown shapes are skipped, so a format change shrinks the split instead of failing.
// Upgrade path: a Paseo or provider API that reports the context breakdown.
export async function measureTranscript(file: string) {
  const parts = new Map<string, ContextItem[]>();
  const add = (label: string, ...items: ContextItem[]) =>
    parts.set(label, [...(parts.get(label) ?? []), ...items]);

  for await (const line of createInterface({ input: createReadStream(file) })) {
    if (!line.includes('"type":"attachment"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const attachment = entry?.attachment;
    if (!attachment || typeof attachment.type !== "string") continue;

    if (attachment.type === "prompt_snapshot") {
      // Each snapshot is the whole prompt, so the latest replaces earlier ones.
      if (Array.isArray(attachment.systemPrompt)) {
        parts.set(
          SYSTEM_PROMPT,
          [attachment.cliPrefix, ...attachment.systemPrompt]
            .filter((block) => typeof block === "string" && block.trim())
            .map((block: string) => item(block, block)),
        );
      }
      if (Array.isArray(attachment.tools)) {
        parts.set(
          TOOLS,
          attachment.tools.map((tool: { name?: unknown; description?: unknown; schema?: unknown }) =>
            item(text(tool.name), `${text(tool.description)}\n\n${text(tool.schema)}`),
          ),
        );
      }
      continue;
    }

    const rendered = renderedText(entry.rendered);
    if (!rendered) continue;
    const label = ATTACHMENT_LABELS[attachment.type] ?? OTHER;
    // A listing marked initial is sent again in full (after a compaction, for example).
    if (attachment.isInitial === true) parts.delete(label);
    if (attachment.type === "instructions" && Array.isArray(attachment.files)) {
      add(
        label,
        ...attachment.files.map((memory: { path?: unknown; content?: unknown }) =>
          item(text(memory.path), text(memory.content)),
        ),
      );
      continue;
    }
    add(label, item(TITLES[attachment.type] ?? attachment.type.replaceAll("_", " "), rendered));
    if (Array.isArray(attachment.surfacedDefinitions)) {
      add(
        label,
        ...attachment.surfacedDefinitions.map((tool: { name?: unknown; definition?: unknown }) =>
          item(text(tool.name), text(tool.definition)),
        ),
      );
    }
  }

  return [...parts]
    .map(([label, items]) => ({
      label,
      tokens: sumTokens(items),
      items: items.sort((a, b) => b.tokens - a.tokens),
    }))
    .filter((part) => part.tokens > 0);
}

/** Fixed context parts read from the Claude transcript; empty for other providers. */
export async function measureFixedParts(
  runtimeInfo: { provider: string; sessionId: string | null } | null,
) {
  const sessionId = runtimeInfo?.sessionId;
  // The session ID becomes a file name, so accept only the characters Claude Code uses.
  if (runtimeInfo?.provider !== "claude" || !sessionId || !/^[\w-]+$/.test(sessionId)) return [];
  const file = await findTranscript(sessionId);
  return file ? await measureTranscript(file) : [];
}

export async function measureFixedContext(
  { agentId }: RpcInput<typeof fixedContext>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof fixedContext>> {
  const agent = paseo.agents.ref(agentId);
  await agent.refresh();
  return { parts: await measureFixedParts(agent.runtimeInfo) };
}
