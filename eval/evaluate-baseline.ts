
import fs from "node:fs/promises";
import path from "node:path";
import { cosineSimilarity } from "../src/lib/similarity";

type DatasetRecord = {
  a: string;
  b: string;
  duplicate: boolean;
  topic: string;
};

type EmbeddingCache = Record<string, number[]>;

const DATASET_PATH = path.join(process.cwd(), "eval/dataset.jsonl");
const CACHE_PATH = path.join(process.cwd(), "eval/embeddings-cache.json");

const THRESHOLDS = [0.70, 0.75, 0.80, 0.85, 0.90, 0.95];

async function main() {
  const dataset: DatasetRecord[] = (
    await fs.readFile(DATASET_PATH, "utf8")
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));

  const cache: EmbeddingCache = JSON.parse(
    await fs.readFile(CACHE_PATH, "utf8")
  );

  const missing = dataset.flatMap(item =>
    [item.a, item.b].filter(question => !cache[question])
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing embeddings for ${new Set(missing).size} questions.`
    );
  }

  const results = dataset.map(item => ({
    ...item,
    similarity: cosineSimilarity(cache[item.a], cache[item.b]),
  }));

  console.log("\n===== CONFIGURATION A: EMBEDDINGS ONLY =====");
  console.log(`Dataset pairs: ${results.length}\n`);

  for (const threshold of THRESHOLDS) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;

    for (const item of results) {
      const predictedDuplicate = item.similarity >= threshold;

      if (predictedDuplicate && item.duplicate) tp++;
      else if (predictedDuplicate && !item.duplicate) fp++;
      else if (!predictedDuplicate && item.duplicate) fn++;
      else tn++;
    }

    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);

    const f1 =
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall);

    console.log(`Threshold: ${threshold.toFixed(2)}`);
    console.log(`TP: ${tp} | FP: ${fp} | FN: ${fn} | TN: ${tn}`);
    console.log(`Precision: ${(precision * 100).toFixed(2)}%`);
    console.log(`Recall: ${(recall * 100).toFixed(2)}%`);
    console.log(`F1: ${(f1 * 100).toFixed(2)}%`);
    console.log(`False merges: ${fp}`);
    console.log(`Missed duplicates: ${fn}`);
    console.log("----------------------------------------");
  }
}

main().catch(error => {
  console.error("Baseline evaluation failed:", error);
  process.exit(1);
});
