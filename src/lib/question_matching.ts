
import { cosineSimilarity } from "./similarity";

export type ExistingQuestionEmbedding = {
  questionId: string;
  clusterId: string;
  vector: number[];
};

export type MatchResult = {
  clusterId: string;
  questionId: string;
  similarity: number;
};

export function findBestMatch(
  incomingVector: number[],
  existing: ExistingQuestionEmbedding[],
  threshold = 0.85
): MatchResult | null {
  let bestMatch: MatchResult | null = null;

  for (const item of existing) {
    // Skip malformed or incompatible vectors.
    if (
      !Array.isArray(item.vector) ||
      item.vector.length !== incomingVector.length ||
      item.vector.length === 0
    ) {
      continue;
    }

    const similarity = cosineSimilarity(
      incomingVector,
      item.vector
    );

    if (
      similarity >= threshold &&
      (!bestMatch || similarity > bestMatch.similarity)
    ) {
      bestMatch = {
        clusterId: item.clusterId,
        questionId: item.questionId,
        similarity,
      };
    }
  }

  return bestMatch;
}
