import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { forgetBase, rememberBase } from "./server/diff";
import { type Judge, httpJudge } from "./server/judge";
import {
  type ReviewInput,
  feedbackMessage,
  forgetReview,
  latestReview,
  rulesIndex,
  startReview,
} from "./server/review";
import { getReview, judgeSettings, runReview, sendFeedback } from "./shared/contracts";

type Settings = z.infer<typeof judgeSettings.schema>;

// One judge per configuration, so every review shares its limit on calls in flight.
let judge: { key: string; run: Judge } | null = null;

function judgeFor({ judgeUrl, model, apiKey: stored }: Settings) {
  const apiKey = process.env.PASEO_RULES_JUDGE_KEY || stored;
  if (!apiKey) return null;
  // The key goes to this address, so refuse anything that would send it unencrypted.
  if (!/^https:\/\//i.test(judgeUrl)) {
    throw new Error("The judge URL must start with https://.");
  }
  const key = JSON.stringify([judgeUrl, model, apiKey]);
  if (judge?.key !== key) judge = { key, run: httpJudge({ url: judgeUrl, model, apiKey }) };
  return judge.run;
}

export default function contribute(server: PluginServerContext) {
  const stored = server.registerSettings(judgeSettings);
  const settings = async () => {
    const state = await stored.read();
    return state.status === "ready" ? state.values : judgeSettings.schema.parse({});
  };
  const check = (agentId: string, cwd: string) =>
    startReview(agentId, async (): Promise<ReviewInput> => {
      const values = await settings();
      return {
        cwd,
        agentId,
        globalRulesDir: values.globalRulesDir,
        judge: judgeFor(values),
        model: values.model,
      };
    });

  server.before("agent.create", async ({ request }) => {
    // Internal agents write commit messages and titles. They edit no code.
    if (request.config.internal) return;
    try {
      const index = await rulesIndex(request.config.cwd, (await settings()).globalRulesDir);
      if (!index) return;
      return {
        ...request,
        config: {
          ...request.config,
          systemPrompt: [request.config.systemPrompt, index].filter(Boolean).join("\n\n"),
        },
      };
    } catch (error) {
      // A throwing before hook fails the creation, and a broken rules directory must not do that.
      console.error("Could not build the rules index.", error);
    }
  });

  server.on("agent.created", ({ agent }) => rememberBase(agent.cwd, agent.id));
  // Covers agents that existed before this plugin was installed.
  server.on("agent.turn_started", ({ agent }) => rememberBase(agent.cwd, agent.id));
  // The check runs detached because a hook has 30 seconds and a large change can take longer.
  server.on("agent.turn_ended", async ({ agent, outcome }) => {
    if (outcome.kind === "completed" && (await settings()).autoCheck) check(agent.id, agent.cwd);
  });
  server.on("agent.archived", ({ agent }) => {
    forgetReview(agent.id);
    return forgetBase(agent.cwd, agent.id);
  });

  server.handle(getReview, ({ agentId }) => ({ review: latestReview(agentId) }));

  server.handle(runReview, async ({ agentId }, { paseo }) => {
    const agent = paseo.agents.ref(agentId);
    await agent.refresh();
    if (!agent.cwd) throw new Error("This agent no longer exists.");
    check(agentId, agent.cwd);
    return {};
  });

  server.handle(sendFeedback, async ({ agentId, findingIds }, { paseo }) => {
    const result = latestReview(agentId);
    if (!result) throw new Error("There is no check for this agent yet. Run one first.");
    const { text, count } = feedbackMessage(result, findingIds);
    if (count === 0) throw new Error("Those findings are not in the latest check. Refresh and try again.");
    await paseo.agents.ref(agentId).send(text);
    return { sent: count };
  });

  return () => {};
}
