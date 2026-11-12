
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

export function findTopMatches(
  incomingVector: number[],
  existing: ExistingQuestionEmbedding[],
  threshold = 0.85,
  limit = 3
): MatchResult[] {
  const matches: MatchResult[] = [];

  for (const item of existing) {
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

    if (similarity >= threshold) {
      matches.push({
        clusterId: item.clusterId,
        questionId: item.questionId,
        similarity,
      });
    }
  }

  return matches
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
