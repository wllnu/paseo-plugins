import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// The parts of the context that are not conversation: system prompt, tool definitions, memory.
// `parts` is empty when the provider's session record cannot be read.
export const fixedContext = defineRpc({
  name: "context.fixed",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    parts: z.array(
      z.object({
        label: z.string(),
        tokens: z.number(),
        // `text` may be cut short; `tokens` always measures the full item.
        items: z.array(z.object({ title: z.string(), text: z.string(), tokens: z.number() })),
      }),
    ),
  }),
});
