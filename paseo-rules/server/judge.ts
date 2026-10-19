import { z } from "zod";

export interface Question {
  type: "choice";
  instructions: string;
  /** Maps each label to what it means. */
  criteria: Record<string, string>;
}

export interface Answer {
  choice: string;
  probabilities: Record<string, number>;
}

/** Answers every question about `state` in one call. Rejects when the judge cannot answer. */
export type Judge = (
  state: Record<string, unknown>,
  questions: Record<string, Question>,
) => Promise<Record<string, Answer>>;

// The decisions API as OpenRouter documents it for TypeSafe's Jev. Other fields are ignored.
const responseSchema = z.object({
  answers: z.record(
    z.string(),
    z.object({ choice: z.string(), probabilities: z.record(z.string(), z.number()) }),
  ),
});

const MAX_IN_FLIGHT = 4;
const TIMEOUT_MS = 60_000;

export function httpJudge({ url, model, apiKey }: { url: string; model: string; apiKey: string }): Judge {
  let inFlight = 0;
  const waiting: Array<() => void> = [];

  async function post(body: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (response.ok) return await response.json();
      const retry = response.status === 429 || response.status >= 500;
      // The body explains a rejected request. It never contains the key, which only goes out in a header.
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw Object.assign(new Error(`Judge returned ${response.status}. ${detail}`), { retry });
    } finally {
      clearTimeout(timer);
    }
  }

  return async (state, questions) => {
    // A finished call hands its slot to the next waiter, so the count never passes the limit.
    if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
    else inFlight += 1;
    try {
      const body = JSON.stringify({ model, state, questions });
      const json = await post(body).catch((error) => (error?.retry ? post(body) : Promise.reject(error)));
      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) throw new Error("Judge reply did not match the decisions API shape.");
      for (const id of Object.keys(questions)) {
        if (!parsed.data.answers[id]) throw new Error(`Judge reply has no answer for question ${id}.`);
      }
      return parsed.data.answers;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else inFlight -= 1;
    }
  };
}
