
import { groqProvider } from "./groq";
import { geminiProvider } from "./gemini";

import type {
  JudgeProvider,
  JudgeProviderName,
  JudgeResult,
} from "./types";

export type JudgeExecutionResult = {
  result: JudgeResult;
  provider: JudgeProviderName;
};

export class JudgeUnavailableError extends Error {
  constructor() {
    super("All LLM judge providers are unavailable.");
    this.name = "JudgeUnavailableError";
  }
}

function getHttpStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error
  ) {
    const status = (error as { status: unknown }).status;

    if (typeof status === "number") {
      return status;
    }
  }

  return undefined;
}


function isFallbackEligible(error: unknown): boolean {
  const status = getHttpStatus(error);

  // Don't retry authentication or permission errors.
  if (status === 401 || status === 403) {
    return false;
  }

  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("not configured")
  ) {
    return false;
  }

  // Rate limits and temporary server failures.
  if (status === 429 || (status !== undefined && status >= 500)) {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Invalid or incomplete model responses.
    if (
      message.includes("invalid json") ||
      message.includes("invalid judge result") ||
      message.includes("empty response")
    ) {
      return true;
    }

    // Timeouts and network failures.
    if (
      error.name === "AbortError" ||
      error.name === "APIConnectionError" ||
      message.includes("timed out") ||
      message.includes("timeout") ||
      message.includes("fetch failed")
    ) {
      return true;
    }
  }
  return false;
}


function validateProviderResponse(
  raw: string,
  validate: (value: unknown) => JudgeResult
): JudgeResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Provider returned invalid JSON.");
  }

  const result = validate(parsed);

  if (
    result.reason === "invalid_response" ||
    result.reason === "invalid_index"
  ) {
    throw new Error("Provider returned an invalid judge result.");
  }

  return result;
}

export async function runJudgeWithFallback(
  prompt: string,
  validate: (value: unknown) => JudgeResult
): Promise<JudgeExecutionResult> {
  const providers: JudgeProvider[] = [
    groqProvider,
    geminiProvider,
  ];

  for (const provider of providers) {
    try {
      console.info(`Running ${provider.name} judge...`);

      const raw = await provider.judge(prompt);

      const result = validateProviderResponse(raw, validate);

      console.info(`${provider.name} judge succeeded.`);

      return {
        result,
        provider: provider.name,
      };
    } catch (error) {
      console.error(
        `${provider.name} judge failed:`,
        error
      );

      // A configuration or authentication error should
      // be fixed rather than silently hidden by fallback.
      if (!isFallbackEligible(error)) {
        throw error;
      }

      // Continue to the next provider.
    }
  }

  throw new JudgeUnavailableError();
}
