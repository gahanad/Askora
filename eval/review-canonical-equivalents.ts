
import fs from "node:fs/promises";
import path from "node:path";
import { cosineSimilarity } from "../src/lib/similarity";

type DatasetRecord = {
  a: string;
  b: string;
  duplicate: boolean;
  topic: string;
};

type CanonicalQuestion = {
  clusterId: string;
  text: string;
};

type PotentialPair = {
  topic: string;
  question1: CanonicalQuestion;
  question2: CanonicalQuestion;
  score: number;
  sameIntent: boolean | null;
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
  "eval/canonical-equivalence-review.json"
);

const MIN_SCORE = 0.85;

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

  // Build canonical questions using the same logic
  // as the retrieval preparation script.
  const canonicalPools = new Map<
    string,
    CanonicalQuestion[]
  >();

  dataset.forEach((item, index) => {
    if (!canonicalPools.has(item.topic)) {
      canonicalPools.set(item.topic, []);
    }

    const pool = canonicalPools.get(item.topic)!;

    const alreadyExists = pool.some(
      question => question.text === item.a
    );

    if (!alreadyExists) {
      pool.push({
        clusterId: `cluster-${index}`,
        text: item.a,
      });
    }
  });

  const potentialPairs: PotentialPair[] = [];

  // Compare every pair of canonical questions
  // within the same topic.
  for (const [topic, questions] of canonicalPools) {
    for (let i = 0; i < questions.length; i++) {
      for (let j = i + 1; j < questions.length; j++) {
        const q1 = questions[i];
        const q2 = questions[j];

        const score = cosineSimilarity(
          embeddings[q1.text],
          embeddings[q2.text]
        );

        if (score >= MIN_SCORE) {
          potentialPairs.push({
            topic,
            question1: q1,
            question2: q2,
            score: Number(score.toFixed(4)),
            sameIntent: null,
          });
        }
      }
    }
  }

  potentialPairs.sort(
    (a, b) => b.score - a.score
  );

  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(potentialPairs, null, 2),
    "utf8"
  );

  console.log("\n===== CANONICAL EQUIVALENCE REVIEW =====");
  console.log(`Canonical questions: ${
    [...canonicalPools.values()]
      .reduce((sum, pool) => sum + pool.length, 0)
  }`);
  console.log(`Potential equivalent pairs: ${potentialPairs.length}`);
  console.log(`Similarity threshold: ${MIN_SCORE}`);
  console.log(`\nSaved to: ${OUTPUT_PATH}`);

  console.log("\nTop 10 potential pairs:");

  potentialPairs.slice(0, 10).forEach((pair, index) => {
    console.log(`\n${index + 1}. ${pair.topic} (${pair.score})`);
    console.log(
      `${pair.question1.clusterId}: ${pair.question1.text}`
    );
    console.log(
      `${pair.question2.clusterId}: ${pair.question2.text}`
    );
  });
}

main().catch(error => {
  console.error("Canonical review preparation failed:", error);
  process.exit(1);
});
