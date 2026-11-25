
import { GoogleGenAI } from "@google/genai";

import type { JudgeProvider } from "./types";

const TIMEOUT_MS = 30000;

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey });
  }

  return geminiClient;
}

export const geminiProvider: JudgeProvider = {
  name: "gemini",

  async judge(prompt: string): Promise<string> {
    const ai = getGeminiClient();

    const model =
      process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),

        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Gemini judge request timed out.")),
            TIMEOUT_MS
          );
        }),
      ]);

      if (!result.text) {
        throw new Error("Gemini returned an empty response.");
      }

      return result.text;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  },
};
