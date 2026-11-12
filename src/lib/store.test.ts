
import { describe, expect, it } from "vitest";
import { InMemoryStore } from "./store";

describe("InMemoryStore", () => {
  it("creates and retrieves a canonical question", async () => {
    const store = new InMemoryStore();

    const clusterId = await store.createCluster(
      "event-1",
      "When is the exam?",
      [1, 0, 0]
    );

    const canonicals = await store.getCanonicals("event-1");

    expect(canonicals).toHaveLength(1);
    expect(canonicals[0].clusterId).toBe(clusterId);
    expect(canonicals[0].text).toBe("When is the exam?");
  });

  it("does not return clusters from another event", async () => {
    const store = new InMemoryStore();

    await store.createCluster("event-1", "Question 1", [1, 0]);
    await store.createCluster("event-2", "Question 2", [0, 1]);

    const canonicals = await store.getCanonicals("event-1");

    expect(canonicals).toHaveLength(1);
    expect(canonicals[0].text).toBe("Question 1");
  });

  it("adds questions without changing the canonical question", async () => {
    const store = new InMemoryStore();

    const clusterId = await store.createCluster(
      "event-1",
      "When is the exam?",
      [1, 0]
    );

    await store.addToCluster(
      clusterId,
      "What is the exam date?"
    );

    const canonicals = await store.getCanonicals("event-1");

    expect(canonicals).toHaveLength(1);
    expect(canonicals[0].text).toBe("When is the exam?");
  });

  it("throws when adding to a nonexistent cluster", async () => {
    const store = new InMemoryStore();

    await expect(
      store.addToCluster("invalid-cluster", "Some question")
    ).rejects.toThrow("does not exist");
  });
});
