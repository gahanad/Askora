
export function cosineSimilarity(
  a: number[],
  b: number[]
): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error("Embeddings must have equal, non-zero dimensions.");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    throw new Error("Cannot compare a zero vector.");
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
