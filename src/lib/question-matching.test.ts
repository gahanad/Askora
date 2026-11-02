
import { describe, expect, it } from "vitest";
import { findBestMatch } from "./question_matching";

describe("findBestMatch", () => {
  it("matches a sufficiently similar question", () => {
    const result = findBestMatch(
      [1, 0, 0],
      [
        {
          questionId: "q1",
          clusterId: "cluster1",
          vector: [0.99, 0.1, 0],
        },
      ],
      0.85
    );

    expect(result?.clusterId).toBe("cluster1");
  });

  it("returns null when no question passes the threshold", () => {
    const result = findBestMatch(
      [1, 0, 0],
      [
        {
          questionId: "q1",
          clusterId: "cluster1",
          vector: [0, 0, 1],
        },
      ],
      0.85
    );

    expect(result).toBeNull();
  });

  it("returns the highest-scoring eligible match", () => {
    const result = findBestMatch(
      [1, 0, 0],
      [
        {
          questionId: "q1",
          clusterId: "cluster1",
          vector: [0.9, 0.2, 0],
        },
        {
          questionId: "q2",
          clusterId: "cluster2",
          vector: [0.99, 0.1, 0],
        },
      ],
      0.85
    );

    expect(result?.clusterId).toBe("cluster2");
  });
});
