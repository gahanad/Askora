
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateContent } = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent,
    };
  },
}));

import { judge } from "./judge";

describe("judge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    vi.stubEnv("GEMINI_TEXT_MODEL", "gemini-2.5-flash");
  });

  it("returns a valid matching candidate index", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        match: 1,
        reason: "Both ask for the exam date.",
      }),
    });

    const result = await judge(
      "When is the exam?",
      [
        { index: 0, text: "Is the exam open-book?" },
        { index: 1, text: "What is the exam date?" },
      ]
    );

    expect(result.match).toBe(1);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("returns null for an invalid candidate index", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        match: 5,
        reason: "Possible match.",
      }),
    });

    const result = await judge(
      "When is the exam?",
      [{ index: 0, text: "What is the exam date?" }]
    );

    expect(result.match).toBeNull();
    expect(result.reason).toBe("invalid_index");
  });

  it("returns judge_unavailable when Gemini returns malformed JSON twice", async () => {
    generateContent
      .mockResolvedValueOnce({ text: "not valid JSON" })
      .mockResolvedValueOnce({ text: "still not valid JSON" });

    const result = await judge(
      "What is the exam date?",
      [{ index: 0, text: "When is the exam?" }]
    );

    expect(result.match).toBeNull();
    expect(result.reason).toBe("judge_unavailable");
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("returns judge_unavailable when Gemini API key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    const result = await judge(
      "When is the exam?",
      [{ index: 0, text: "What is the exam date?" }]
    );

    expect(result.match).toBeNull();
    expect(result.reason).toBe("judge_unavailable");
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("returns no_candidates when there are no candidates", async () => {
    const result = await judge("When is the exam?", []);

    expect(result.match).toBeNull();
    expect(result.reason).toBe("no_candidates");
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("uses cached results for repeated requests", async () => {
    generateContent.mockResolvedValue({
        text: JSON.stringify({
        match: 0,
        reason: "Both ask for the exam date.",
        }),
    });

    // Use a unique question so earlier tests cannot populate its cache.
    const question = "When is the semester orientation scheduled?";
    const candidates = [
        { index: 0, text: "What is the date of semester orientation?" },
    ];

    await judge(question, candidates);
    await judge(question, candidates);

    expect(generateContent).toHaveBeenCalledTimes(1);
  });


  
it("retries once and returns judge_unavailable after timeout", async () => {
  vi.useFakeTimers();

  try {
    generateContent.mockImplementation(
      () => new Promise(() => {})
    );

    const pending = judge(
      "When is the hackathon orientation scheduled?",
      [
        {
          index: 0,
          text: "What is the hackathon orientation date?",
        },
      ]
    );

    // First attempt: 30-second timeout.
    await vi.advanceTimersByTimeAsync(30000);

    // Second attempt: another 30-second timeout.
    await vi.advanceTimersByTimeAsync(30000);

    const result = await pending;

    expect(result.match).toBeNull();
    expect(result.reason).toBe("judge_unavailable");
    expect(generateContent).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

});
