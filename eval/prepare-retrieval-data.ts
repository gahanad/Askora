
import fs from "node:fs/promises";
import path from "node:path";
import { cosineSimilarity } from "../src/lib/similarity";

type DatasetRecord = {
  a: string;
  b: string;
  duplicate: boolean;
  topic: string;
};

type Candidate = {
  clusterId: string;
  text: string;
  score: number;
};

type RetrievalCase = {
  pairIndex: number;
  topic: string;
  incomingQuestion: string;
  expectedClusterId: string | null;
  candidates: Candidate[];
  targetRetrieved: boolean;
};

const DATASET_PATH = path.join(
  process.cwd(),
  "eval/dataset.jsonl"
);

const EMBEDDINGS_PATH = path.join(
  process.cwd(),
  "eval/embeddings-cache.json"
);

const OUTPUT_PATH = path.join(
  process.cwd(),
  "eval/retrieval-cases.json"
);

const MIN_SCORE = 0.70;
const TOP_K = 5;

async function main() {
  const dataset: DatasetRecord[] = (
    await fs.readFile(DATASET_PATH, "utf8")
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));

  const embeddings: Record<string, number[]> =
    JSON.parse(
      await fs.readFile(EMBEDDINGS_PATH, "utf8")
    );

  // Validate that every question has a cached embedding.
  for (const item of dataset) {
    if (!embeddings[item.a] || !embeddings[item.b]) {
      throw new Error(
        `Missing embedding for: ${!embeddings[item.a] ? item.a : item.b}`
      );
    }
  }

  // Build one canonical cluster per unique A question,
  // grouped by topic (simulated event).
  const canonicalPools = new Map<
    string,
    Map<string, string>
  >();

  dataset.forEach((item, index) => {
    if (!canonicalPools.has(item.topic)) {
      canonicalPools.set(item.topic, new Map());
    }

    const pool = canonicalPools.get(item.topic)!;

    if (!pool.has(item.a)) {
      pool.set(item.a, `cluster-${index}`);
    }
  });

  const retrievalCases: RetrievalCase[] = [];

  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i];
    const pool = canonicalPools.get(item.topic)!;

    const expectedClusterId = item.duplicate
      ? pool.get(item.a)!
      : null;

    const scoredCandidates: Candidate[] = [];

    for (const [text, clusterId] of pool) {
      const score = cosineSimilarity(
        embeddings[item.b],
        embeddings[text]
      );

      if (score >= MIN_SCORE) {
        scoredCandidates.push({
          clusterId,
          text,
          score,
        });
      }
    }

    const candidates = scoredCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    const targetRetrieved = expectedClusterId !== null &&
      candidates.some(
        candidate =>
          candidate.clusterId === expectedClusterId
      );

    retrievalCases.push({
      pairIndex: i,
      topic: item.topic,
      incomingQuestion: item.b,
      expectedClusterId,
      candidates,
      targetRetrieved,
    });
  }

  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(retrievalCases, null, 2),
    "utf8"
  );

  const positiveCases = retrievalCases.filter(
    item => item.expectedClusterId !== null
  );

  const negativeCases = retrievalCases.filter(
    item => item.expectedClusterId === null
  );

  const retrieved = positiveCases.filter(
    item => item.targetRetrieved
  ).length;

  console.log("\n===== RETRIEVAL DATA PREPARATION =====");
  console.log(`Total cases: ${retrievalCases.length}`);
  console.log(`Positive cases: ${positiveCases.length}`);
  console.log(`Negative cases: ${negativeCases.length}`);
  console.log(`Target retrieved: ${retrieved}/${positiveCases.length}`);
  console.log(
    `Retrieval Recall@5: ${
      positiveCases.length
        ? ((retrieved / positiveCases.length) * 100).toFixed(2)
        : "0.00"
    }%`
  );

  console.log(`\nSaved to: ${OUTPUT_PATH}`);
}

main().catch(error => {
  console.error("Retrieval preparation failed:", error);
  process.exit(1);
});
