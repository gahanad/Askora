
import { beforeEach, describe, expect, it, vi } from "vitest";

const { groqJudge, geminiJudge } = vi.hoisted(() => ({
  groqJudge: vi.fn(),
  geminiJudge: vi.fn(),
}));

vi.mock("./groq", () => ({
  groqProvider: {
    name: "groq",
    judge: groqJudge,
  },
}));

vi.mock("./gemini", () => ({
  geminiProvider: {
    name: "gemini",
    judge: geminiJudge,
  },
}));

import {
  runJudgeWithFallback,
  JudgeUnavailableError,
} from "./provider";

import type { JudgeResult } from "./types";

const validate = (value: unknown): JudgeResult => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("match" in value) ||
    !("reason" in value)
  ) {
    return { match: null, reason: "invalid_response" };
  }

  const result = value as {
    match: unknown;
    reason: unknown;
  };

  if (
    (result.match !== null && !Number.isInteger(result.match)) ||
    typeof result.reason !== "string"
  ) {
    return { match: null, reason: "invalid_response" };
  }

  return {
    match: result.match as number | null,
    reason: result.reason,
  };
};

const validJoinResponse = JSON.stringify({
  match: 0,
  reason: "Both questions ask for the exam date.",
});

const validCreateResponse = JSON.stringify({
  match: null,
  reason: "These questions ask different things.",
});

describe("runJudgeWithFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses Groq when Groq succeeds", async () => {
    groqJudge.mockResolvedValue(validJoinResponse);

    const result = await runJudgeWithFallback(
      "Test prompt",
      validate
    );

    expect(result.provider).toBe("groq");
    expect(result.result.match).toBe(0);

    expect(groqJudge).toHaveBeenCalledTimes(1);
    expect(geminiJudge).not.toHaveBeenCalled();
  });

  it("falls back to Gemini when Groq times out", async () => {
    groqJudge.mockRejectedValue(
      new Error("Groq request timed out.")
    );

    geminiJudge.mockResolvedValue(validJoinResponse);

    const result = await runJudgeWithFallback(
      "Test prompt",
      validate
    );

    expect(result.provider).toBe("gemini");
    expect(result.result.match).toBe(0);

    expect(groqJudge).toHaveBeenCalledTimes(1);
    expect(geminiJudge).toHaveBeenCalledTimes(1);
  });

  it("falls back to Gemini when Groq returns invalid JSON", async () => {
    groqJudge.mockResolvedValue("not valid JSON");
    geminiJudge.mockResolvedValue(validJoinResponse);

    const result = await runJudgeWithFallback(
      "Test prompt",
      validate
    );

    expect(result.provider).toBe("gemini");
    expect(result.result.match).toBe(0);
  });

  it("falls back to Gemini on HTTP 429", async () => {
    groqJudge.mockRejectedValue(
      Object.assign(new Error("Rate limited"), {
        status: 429,
      })
    );

    geminiJudge.mockResolvedValue(validJoinResponse);

    const result = await runJudgeWithFallback(
      "Test prompt",
      validate
    );

    expect(result.provider).toBe("gemini");
    expect(geminiJudge).toHaveBeenCalledTimes(1);
  });

  it("does not fall back on HTTP 401", async () => {
    groqJudge.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), {
        status: 401,
      })
    );

    await expect(
      runJudgeWithFallback("Test prompt", validate)
    ).rejects.toThrow("Unauthorized");

    expect(geminiJudge).not.toHaveBeenCalled();
  });

  it("does not fall back when Groq is not configured", async () => {
    groqJudge.mockRejectedValue(
      new Error("GROQ_API_KEY is not configured.")
    );

    await expect(
      runJudgeWithFallback("Test prompt", validate)
    ).rejects.toThrow("not configured");

    expect(geminiJudge).not.toHaveBeenCalled();
  });

  it("does not fall back when Groq returns a valid CREATE decision", async () => {
    groqJudge.mockResolvedValue(validCreateResponse);

    const result = await runJudgeWithFallback(
      "Test prompt",
      validate
    );

    expect(result.provider).toBe("groq");
    expect(result.result.match).toBeNull();

    expect(geminiJudge).not.toHaveBeenCalled();
  });

  it("throws JudgeUnavailableError when both providers fail", async () => {
    groqJudge.mockRejectedValue(
      new Error("Groq timed out.")
    );

    geminiJudge.mockRejectedValue(
      new Error("Gemini timed out.")
    );

    await expect(
      runJudgeWithFallback("Test prompt", validate)
    ).rejects.toThrow(JudgeUnavailableError);

    expect(groqJudge).toHaveBeenCalledTimes(1);
    expect(geminiJudge).toHaveBeenCalledTimes(1);
  });

  it("falls back when Groq returns an invalid candidate index", async () => {
    groqJudge.mockResolvedValue(
      JSON.stringify({
        match: 99,
        reason: "Possible match.",
      })
    );

    geminiJudge.mockResolvedValue(validJoinResponse);

    const result = await runJudgeWithFallback(
      "Test prompt",
      (value) => {
        const parsed = value as {
          match: number | null;
          reason: string;
        };

        if (
          parsed.match !== null &&
          parsed.match !== 0
        ) {
          return {
            match: null,
            reason: "invalid_index",
          };
        }

        return validate(value);
      }
    );

    expect(result.provider).toBe("gemini");
    expect(result.result.match).toBe(0);
  });
});
