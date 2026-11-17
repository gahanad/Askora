
import { describe, expect, it } from "vitest";
import { InMemoryStore } from "./store";

const metadata = {
  questionId: "question-1",
  authorId: "user-1",
  requestId: "request-1",
  similarity: 1,
};

describe("InMemoryStore", () => {
  it("creates and retrieves a canonical question", async () => {
    const store = new InMemoryStore();

    const clusterId = await store.createCluster(
      "event-1",
      "When is the exam?",
      [1, 0, 0],
      metadata
    );

    const canonicals = await store.getCanonicals("event-1");

    expect(canonicals).toHaveLength(1);
    expect(canonicals[0].clusterId).toBe(clusterId);
    expect(canonicals[0].text).toBe("When is the exam?");
    expect(canonicals[0].vector).toEqual([1, 0, 0]);
  });

  it("does not return clusters from another event", async () => {
    await storeCreateForEvent("event-1");
  });

  it("adds questions without changing the canonical question", async () => {
    const store = new InMemoryStore();

    const clusterId = await store.createCluster(
      "event-1",
      "When is the exam?",
      [1, 0],
      metadata
    );

    await store.addToCluster(
      clusterId,
      "What is the exam date?",
      [0.9, 0.1],
      {
        ...metadata,
        questionId: "question-2",
        requestId: "request-2",
        similarity: 0.95,
      }
    );

    const canonicals = await store.getCanonicals("event-1");

    expect(canonicals).toHaveLength(1);
    expect(canonicals[0].text).toBe("When is the exam?");
    expect(canonicals[0].vector).toEqual([1, 0]);
  });

  it("throws when adding to a nonexistent cluster", async () => {
    const store = new InMemoryStore();

    await expect(
      store.addToCluster(
        "invalid-cluster",
        "Some question",
        [1, 0],
        metadata
      )
    ).rejects.toThrow("does not exist");
  });
});

async function storeCreateForEvent(eventId: string) {
  const store = new InMemoryStore();

  await store.createCluster(
    eventId,
    "Question 1",
    [1, 0],
    metadata
  );

  await store.createCluster(
    "event-2",
    "Question 2",
    [0, 1],
    {
      ...metadata,
      questionId: "question-2",
    }
  );

  const canonicals = await store.getCanonicals(eventId);

  expect(canonicals).toHaveLength(1);
  expect(canonicals[0].text).toBe("Question 1");
}
