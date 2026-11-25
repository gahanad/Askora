import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./distributed_lock", () => ({
  withDistributedLock: async <T>(
    _lockKey: string,
    task: () => Promise<T>
  ): Promise<T> => task(),
}));

import { assignQuestion } from "./assign";
import { InMemoryStore } from "./store";

describe("assignQuestion", () => {
  let store: InMemoryStore;

  const embed = vi.fn();
  const judge = vi.fn();

  const metadata = {
    questionId: "question-new",
    authorId: "user-1",
    requestId: "request-1",
  };

  beforeEach(() => {
    store = new InMemoryStore();
    vi.clearAllMocks();

    embed.mockResolvedValue([1, 0]);
    judge.mockResolvedValue({
      match: null,
      reason: "No matching intent.",
    });
  });

  it("does not create a cluster when embedding generation fails", async () => {
    embed.mockRejectedValue(new Error("Embedding failed"));

    await expect(
      assignQuestion(
        store,
        "event-1",
        "When is the exam?",
        metadata,
        { embed, judge }
      )
    ).rejects.toThrow("EMBEDDING_UNAVAILABLE");

    expect(embed).toHaveBeenCalledTimes(1);
    expect(judge).not.toHaveBeenCalled();

    const canonicals = await store.getCanonicals("event-1");

    expect(canonicals).toHaveLength(0);
  });

  it("creates a cluster when no candidates are found", async () => {
    const result = await assignQuestion(
      store,
      "event-1",
      "When is the exam?",
      metadata,
      { embed, judge }
    );

    expect(result.decision).toBe("CREATED");
    expect(result.stage).toBe("no_candidates");
    expect(result.questionId).toBe(metadata.questionId);
    expect(result.similarity).toBe(1);
    expect(judge).not.toHaveBeenCalled();
  });

  it("creates a cluster when conflicting facts block all candidates", async () => {
    await store.createCluster(
      "event-1",
      "When is Assignment 3 due?",
      [1, 0],
      {
        ...metadata,
        questionId: "question-existing",
        similarity: 1,
      }
    );

    const result = await assignQuestion(
      store,
      "event-1",
      "When is Assignment 4 due?",
      metadata,
      { embed, judge }
    );

    expect(result.decision).toBe("CREATED");
    expect(result.stage).toBe("guard_blocked");
    expect(result.questionId).toBe(metadata.questionId);
    expect(judge).not.toHaveBeenCalled();
  });

  it("joins an existing cluster when Gemini confirms a match", async () => {
    const existingClusterId = await store.createCluster(
      "event-1",
      "When is the exam?",
      [1, 0],
      {
        ...metadata,
        questionId: "question-existing",
        similarity: 1,
      }
    );

    const addToClusterSpy = vi.spyOn(store, "addToCluster");

    judge.mockResolvedValue({
      match: 0,
      reason: "Both ask for the exam date.",
    });

    const result = await assignQuestion(
      store,
      "event-1",
      "What is the exam date?",
      metadata,
      { embed, judge }
    );

    expect(result.decision).toBe("JOINED");
    expect(result.stage).toBe("judge_match");
    expect(result.clusterId).toBe(existingClusterId);
    expect(result.questionId).toBe(metadata.questionId);
    expect(result.similarity).toBeGreaterThanOrEqual(0.70);

    expect(addToClusterSpy).toHaveBeenCalledWith(
      existingClusterId,
      "What is the exam date?",
      [1, 0],
      {
        ...metadata,
        similarity: expect.any(Number),
      }
    );
  });

  it("creates a new cluster when Gemini rejects all candidates", async () => {
    await store.createCluster(
      "event-1",
      "When is the exam?",
      [1, 0],
      {
        ...metadata,
        questionId: "question-existing",
        similarity: 1,
      }
    );

    judge.mockResolvedValue({
      match: null,
      reason: "They request different information.",
    });

    const result = await assignQuestion(
      store,
      "event-1",
      "Is the exam open-book?",
      metadata,
      { embed, judge }
    );

    expect(result.decision).toBe("CREATED");
    expect(result.stage).toBe("judge_no_match");
    expect(result.questionId).toBe(metadata.questionId);
    expect(result.similarity).toBe(1);
  });

  it("does not create a cluster when all judge providers are unavailable", async () => {
    await store.createCluster(
      "event-1",
      "When is the exam?",
      [1, 0],
      {
        ...metadata,
        questionId: "question-existing",
        similarity: 1,
      }
    );

    judge.mockResolvedValue({
      match: null,
      reason: "judge_unavailable",
    });

    await expect(
      assignQuestion(
        store,
        "event-1",
        "What is the exam date?",
        metadata,
        { embed, judge }
      )
    ).rejects.toThrow("JUDGE_UNAVAILABLE");

    const canonicals = await store.getCanonicals("event-1");

    expect(canonicals).toHaveLength(1);
  });


  it("does not create a cluster when the judge throws an exception", async () => {
    await store.createCluster(
      "event-1",
      "When is the exam?",
      [1, 0],
      {
        ...metadata,
        questionId: "question-existing",
        similarity: 1,
      }
    );

    judge.mockRejectedValue(
      new Error("LLM provider unavailable")
    );

    await expect(
      assignQuestion(
        store,
        "event-1",
        "What is the exam date?",
        metadata,
        { embed, judge }
      )
    ).rejects.toThrow("JUDGE_UNAVAILABLE");

    const canonicals = await store.getCanonicals("event-1");

    expect(canonicals).toHaveLength(1);
  });
});
