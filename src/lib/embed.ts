
import { GoogleGenAI } from "@google/genai";

export class EmbedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedError";
  }
}

const TIMEOUT_MS = 3000;
const MAX_ATTEMPTS = 2;

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0)
  );

  if (
    vector.length === 0 ||
    !vector.every(Number.isFinite) ||
    magnitude === 0
  ) {
    throw new EmbedError("Gemini returned an invalid embedding.");
  }

  return vector.map((value) => value / magnitude);
}

async function generateWithTimeout(
  ai: GoogleGenAI,
  text: string
): Promise<number[]> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      ai.models.embedContent({
        model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
        contents: text,
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new EmbedError("Embedding request timed out.")),
          TIMEOUT_MS
        );
      }),
    ]);

    const vector = result.embeddings?.[0]?.values;

    if (!vector || vector.length === 0) {
      throw new EmbedError("Gemini returned an empty embedding.");
    }

    return normalizeVector(vector);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new EmbedError("GEMINI_API_KEY is not configured.");
  }

  if (!text.trim()) {
    throw new EmbedError("Cannot generate an embedding for empty text.");
  }

  const ai = new GoogleGenAI({ apiKey });

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await generateWithTimeout(ai, text);
    } catch (error) {
      lastError = error;
    }
  }

  const message =
    lastError instanceof Error
      ? lastError.message
      : "Unknown embedding generation error.";

  throw new EmbedError(
    `Embedding generation failed after ${MAX_ATTEMPTS} attempts: ${message}`
  );
}
