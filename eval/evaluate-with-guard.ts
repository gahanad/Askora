
import fs from "node:fs/promises";
import path from "node:path";
import { cosineSimilarity } from "../src/lib/similarity";
import { conflictingFacts } from "../src/lib/guard";

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

  console.log("\n===== CONFIGURATION B: EMBEDDINGS + GUARD =====");
  console.log(`Dataset pairs: ${dataset.length}\n`);

  for (const threshold of THRESHOLDS) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    let blocked = 0;

    for (const item of dataset) {
      const similarity = cosineSimilarity(
        cache[item.a],
        cache[item.b]
      );

      const similarityMatch = similarity >= threshold;
      const guardBlocked = conflictingFacts(item.a, item.b);

      if (similarityMatch && guardBlocked) {
        blocked++;
      }

      const predictedDuplicate =
        similarityMatch && !guardBlocked;

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
    console.log(`Blocked by guard: ${blocked}`);
    console.log("----------------------------------------");
  }
}

main().catch(error => {
  console.error("Guard evaluation failed:", error);
  process.exit(1);
});
