// Run: node --experimental-strip-types server/judge.check.ts
// Talks to a local stand-in that replies in the documented decisions shape. Needs no key.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Question, httpJudge } from "./judge.ts";

function equal(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

let mode: "ok" | "busy-once" | "denied" | "empty" = "ok";
let requests = 0;
let inFlight = 0;
let peak = 0;
let last: { auth?: string; body?: { model: string; state: unknown; questions: Record<string, Question> } } = {};

const server = createServer((request, response) => {
  let text = "";
  request.on("data", (chunk) => (text += chunk));
  request.on("end", async () => {
    requests += 1;
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 15));
    inFlight -= 1;
    const body = JSON.parse(text);
    last = { auth: request.headers.authorization, body };
    if (mode === "busy-once" && requests === 1) return response.writeHead(429).end("slow down");
    if (mode === "denied") return response.writeHead(401).end("bad key");
    const answers =
      mode === "empty"
        ? {}
        : Object.fromEntries(
            Object.keys(body.questions).map((id) => [
              id,
              {
                type: "choice",
                choice: "followed",
                confidence: 0.9,
                probabilities: { followed: 0.9, violated: 0.05, not_applicable: 0.05 },
              },
            ]),
          );
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        id: "decision-1",
        model: body.model,
        provider: "stand-in",
        answers,
        usage: { input_tokens: 10, output_tokens: 0, cost: 0 },
      }),
    );
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/decisions`;
const question: Question = { type: "choice", instructions: "Rule: r", criteria: { followed: "f", violated: "v" } };
const reset = (next: typeof mode) => {
  mode = next;
  requests = 0;
  peak = 0;
};
const failure = (work: Promise<unknown>) =>
  work.then(
    () => "",
    (error: Error) => error.message,
  );

try {
  const judge = httpJudge({ url, model: "typesafe/jev-1.13", apiKey: "secret" });

  const answers = await judge({ file: "a.ts", diff: "+x" }, { r0: question });
  equal(answers.r0.choice, "followed", "choice");
  equal(answers.r0.probabilities.violated, 0.05, "probabilities");
  equal(last.auth, "Bearer secret", "the key goes out as a bearer token");
  equal(
    last.body,
    { model: "typesafe/jev-1.13", state: { file: "a.ts", diff: "+x" }, questions: { r0: question } },
    "request body",
  );

  reset("ok");
  await Promise.all(Array.from({ length: 12 }, (_, i) => judge({ i }, { r0: question })));
  equal(requests, 12, "every call is sent");
  equal(peak, 4, "at most four calls are in flight");

  reset("busy-once");
  equal((await judge({}, { r0: question })).r0.choice, "followed", "a 429 is retried");
  equal(requests, 2, "one retry");

  reset("denied");
  equal(await failure(judge({}, { r0: question })), "Judge returned 401. bad key", "a rejected key is reported");
  equal(requests, 1, "a 401 is not retried");

  reset("empty");
  equal(
    await failure(judge({}, { r0: question })),
    "Judge reply has no answer for question r0.",
    "a missing answer is an error",
  );

  reset("ok");
  await Promise.all(Array.from({ length: 6 }, () => judge({}, { r0: question })));
  equal(peak, 4, "failed calls give their slots back");

  console.log("judge.check ok");
} finally {
  server.close();
}
