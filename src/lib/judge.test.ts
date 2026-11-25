
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runJudgeWithFallback } = vi.hoisted(() => ({
  runJudgeWithFallback: vi.fn(),
}));

vi.mock("./llm/provider", () => ({
  runJudgeWithFallback,
}));

import { judge } from "./judge";

describe("judge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a valid matching candidate index", async () => {
    runJudgeWithFallback.mockImplementation(
      async (
        _prompt: string,
        validate: (value: unknown) => unknown
      ) => ({
        result: validate({
          match: 1,
          reason: "Both ask for the exam date.",
        }),
        provider: "groq",
      })
    );

    const result = await judge(
      "When is the exam?",
      [
        { index: 0, text: "Is the exam open-book?" },
        { index: 1, text: "What is the exam date?" },
      ]
    );

    expect(result.match).toBe(1);
    expect(result.reason).toBe("Both ask for the exam date.");
    expect(runJudgeWithFallback).toHaveBeenCalledTimes(1);
  });

  it("returns no_candidates when there are no candidates", async () => {
    const result = await judge("When is the exam?", []);

    expect(result).toEqual({
      match: null,
      reason: "no_candidates",
    });

    expect(runJudgeWithFallback).not.toHaveBeenCalled();
  });

  it("returns empty_question for an empty question", async () => {
    const result = await judge("   ", [
      { index: 0, text: "What is the exam date?" },
    ]);

    expect(result).toEqual({
      match: null,
      reason: "empty_question",
    });

    expect(runJudgeWithFallback).not.toHaveBeenCalled();
  });

  it("rejects more than three candidates", async () => {
    const result = await judge("When is the exam?", [
      { index: 0, text: "Question one" },
      { index: 1, text: "Question two" },
      { index: 2, text: "Question three" },
      { index: 3, text: "Question four" },
    ]);

    expect(result.reason).toBe("invalid_candidates");
    expect(runJudgeWithFallback).not.toHaveBeenCalled();
  });

  it("rejects duplicate candidate indices", async () => {
    const result = await judge("When is the exam?", [
      { index: 0, text: "Question one" },
      { index: 0, text: "Question two" },
    ]);

    expect(result.reason).toBe("invalid_candidates");
    expect(runJudgeWithFallback).not.toHaveBeenCalled();
  });

  it("returns judge_unavailable when provider orchestration fails", async () => {
    runJudgeWithFallback.mockRejectedValue(
      new Error("All LLM judge providers are unavailable.")
    );

    const result = await judge(
      "What is the exam date?",
      [{ index: 0, text: "When is the exam?" }]
    );

    expect(result).toEqual({
      match: null,
      reason: "judge_unavailable",
    });
  });

  it("uses cached results for repeated requests", async () => {
    runJudgeWithFallback.mockImplementation(
      async (
        _prompt: string,
        validate: (value: unknown) => unknown
      ) => ({
        result: validate({
          match: 0,
          reason: "Both ask for the orientation date.",
        }),
        provider: "groq",
      })
    );

    const question =
      "When is the semester orientation scheduled?";

    const candidates = [
      {
        index: 0,
        text: "What is the date of semester orientation?",
      },
    ];

    const firstResult = await judge(question, candidates);
    const secondResult = await judge(question, candidates);

    expect(firstResult).toEqual(secondResult);
    expect(runJudgeWithFallback).toHaveBeenCalledTimes(1);
  });
});
