
import { describe, expect, it } from "vitest";
import { findCandidates } from "./candidates";
import { InMemoryStore } from "./store";

const createMetadata = (requestId: string) => ({
  questionId: `question-${requestId}`,
  authorId: "test-user",
  requestId,
  similarity: 1,
});

describe("findCandidates", () => {
  it("returns candidates above the similarity threshold", async () => {
    const store = new InMemoryStore();

    await store.createCluster(
      "event-1", "Question A", [1, 0],
      createMetadata("request-1")
    );
    await store.createCluster(
      "event-1", "Question B", [0.9, 0.1],
      createMetadata("request-2")
    );
    await store.createCluster(
      "event-1", "Question C", [0, 1],
      createMetadata("request-3")
    );

    const result = await findCandidates(
      store,
      "event-1",
      [1, 0]
    );

    expect(result.length).toBe(2);
    expect(result[0].text).toBe("Question A");
    expect(result[1].text).toBe("Question B");
  });

  it("returns candidates in descending similarity order", async () => {
    const store = new InMemoryStore();

    await store.createCluster(
      "event-1", "Lower match", [0.8, 0.6],
      createMetadata("request-4")
    );
    await store.createCluster(
      "event-1", "Higher match", [0.99, 0.1],
      createMetadata("request-5")
    );

    const result = await findCandidates(
      store,
      "event-1",
      [1, 0]
    );

    expect(result[0].text).toBe("Higher match");
    expect(result[1].text).toBe("Lower match");
  });

  it("returns at most three candidates by default", async () => {
    const store = new InMemoryStore();

    for (let i = 0; i < 6; i++) {
      await store.createCluster(
        "event-1",
        `Question ${i}`,
        [1, i * 0.01],
        createMetadata(`request-${i + 6}`)
      );
    }

    const result = await findCandidates(
      store,
      "event-1",
      [1, 0]
    );

    expect(result).toHaveLength(3);
  });

  it("does not retrieve candidates from another event", async () => {
    const store = new InMemoryStore();

    await store.createCluster(
      "event-1", "Same event", [1, 0],
      createMetadata("request-12")
    );
    await store.createCluster(
      "event-2", "Other event", [1, 0],
      createMetadata("request-13")
    );

    const result = await findCandidates(
      store,
      "event-1",
      [1, 0]
    );

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Same event");
  });

  it("returns an empty array when no candidate passes the threshold", async () => {
    const store = new InMemoryStore();

    await store.createCluster(
      "event-1", "Unrelated question", [0, 1],
      createMetadata("request-14")
    );

    const result = await findCandidates(
      store,
      "event-1",
      [1, 0]
    );

    expect(result).toEqual([]);
  });

  it("supports custom threshold and candidate limit", async () => {
    const store = new InMemoryStore();

    await store.createCluster(
      "event-1", "Question A", [1, 0],
      createMetadata("request-15")
    );
    await store.createCluster(
      "event-1", "Question B", [0.9, 0.1],
      createMetadata("request-16")
    );

    const result = await findCandidates(
      store,
      "event-1",
      [1, 0],
      { k: 1, minScore: 0.5 }
    );

    expect(result).toHaveLength(1);
  });
});
