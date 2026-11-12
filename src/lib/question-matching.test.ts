
import { describe, expect, it } from "vitest";
import { findTopMatches } from "./question_matching";

describe("findTopMatches", () => {
  it("returns sufficiently similar questions", () => {
    const result = findTopMatches(
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

    expect(result).toHaveLength(1);
    expect(result[0].clusterId).toBe("cluster1");
  });

  it("returns an empty array when no question passes the threshold", () => {
    const result = findTopMatches(
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

    expect(result).toEqual([]);
  });

  it("returns matches sorted by highest similarity", () => {
    const result = findTopMatches(
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

    expect(result[0].clusterId).toBe("cluster2");
    expect(result[1].clusterId).toBe("cluster1");
  });
});
