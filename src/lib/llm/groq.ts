
import Groq from "groq-sdk";

import type { JudgeProvider } from "./types";

const TIMEOUT_MS = 30000;

let groqClient: Groq | null = null;

function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  if (!groqClient) {
    groqClient = new Groq({ apiKey });
  }

  return groqClient;
}

export const groqProvider: JudgeProvider = {
  name: "groq",

  async judge(prompt: string): Promise<string> {
    const client = getGroqClient();

    const model =
      process.env.GROQ_MODEL || "openai/gpt-oss-20b";

    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);

    try {
      const completion =
        await client.chat.completions.create(
          {
            model,
            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
            temperature: 0,
            response_format: {
              type: "json_object",
            },
          },
          {
            signal: controller.signal,
          }
        );

      const content =
        completion.choices[0]?.message?.content;

      if (!content || typeof content !== "string") {
        throw new Error("Groq returned an empty response.");
      }

      return content;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Groq judge request timed out.");
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },
};
