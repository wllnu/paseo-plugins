import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const stopAgent = defineRpc({
  name: "agent.stop",
  input: z.object({ agentId: z.uuid() }),
  output: z.object({}),
});
