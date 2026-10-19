/// <reference types="node" />
import type { RpcInput } from "@getpaseo/plugin";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { stopAgent } from "../shared/stop";

const run = promisify(execFile);

// lazy: the plugin SDK (0.10.2) has no interrupt method, so this shells out to `paseo stop`.
// Upgrade path: call the SDK directly once agent handles expose cancel.
const CLI_PATHS = ["paseo", "/Applications/Paseo.app/Contents/Resources/bin/paseo"];

export async function stop({ agentId }: RpcInput<typeof stopAgent>) {
  for (const cli of CLI_PATHS) {
    try {
      await run(cli, ["stop", agentId], { timeout: 15_000 });
      return {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("Could not find the paseo CLI on the daemon machine.");
}
