
import { cosineSimilarity } from "./similarity";
import type { ClusterStore } from "./store";

export type Candidate = {
  clusterId: string;
  text: string;
  score: number;
};

export type CandidateOptions = {
  k?: number;
  minScore?: number;
};

export async function findCandidates(
  store: ClusterStore,
  eventId: string,
  incomingVector: number[],
  options: CandidateOptions = {}
): Promise<Candidate[]> {
  const {
    k = 5,
    minScore = 0.70,
  } = options;

  if (!Number.isInteger(k) || k < 1) {
    throw new Error("k must be a positive integer.");
  }

  if (minScore < -1 || minScore > 1) {
    throw new Error("minScore must be between -1 and 1.");
  }

  const canonicals = await store.getCanonicals(eventId);

  const scoredCandidates: Candidate[] = [];

  for (const canonical of canonicals) {
    try {
      const score = cosineSimilarity(
        incomingVector,
        canonical.vector
      );

      if (score >= minScore) {
        scoredCandidates.push({
          clusterId: canonical.clusterId,
          text: canonical.text,
          score,
        });
      }
    } catch {
      // Skip invalid or incompatible stored vectors.
      continue;
    }
  }

  return scoredCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .slice(0, 3);
}
