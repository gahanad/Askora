
import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "./similarity";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
  });

  it("handles vectors with different magnitudes", () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1);
  });

  it("throws for vectors with different dimensions", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });

  it("throws for empty vectors", () => {
    expect(() => cosineSimilarity([], [])).toThrow();
  });

  it("throws for zero vectors", () => {
    expect(() => cosineSimilarity([0, 0], [1, 2])).toThrow();
  });

  it("throws for non-finite values", () => {
    expect(() => cosineSimilarity([1, NaN], [1, 2])).toThrow();
  });
});
