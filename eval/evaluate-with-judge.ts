
import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { judge } from "../src/lib/judge";
import { conflictingFacts } from "../src/lib/guard";

loadEnvConfig(process.cwd());

type DatasetRecord = {
  a: string;
  b: string;
  duplicate: boolean;
  topic: string;
};

type EvaluationResult = {
  predicted: boolean;
  reason: string;
};

type ResultCache = Record<string, EvaluationResult>;

const DATASET_PATH = path.join(process.cwd(), "eval/dataset.jsonl");
const RESULT_PATH = path.join(process.cwd(), "eval/judge-results.json");
const REQUEST_DELAY_MS = 5000;

async function main() {
  const dataset: DatasetRecord[] = (
    await fs.readFile(DATASET_PATH, "utf8")
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));

  let cache: ResultCache = {};

  try {
    cache = JSON.parse(await fs.readFile(RESULT_PATH, "utf8"));
  } catch {
    console.log("No previous judge results found. Starting fresh.");
  }

  let completed = 0;

  console.log("\n===== CONFIGURATION C: EMBEDDINGS + GUARD + JUDGE =====");
  console.log(`Dataset pairs: ${dataset.length}`);

  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i];
    const key = String(i);

    if (cache[key]) {
      completed++;
      continue;
    }

    // Apply the same guard used in Configuration B.
    if (conflictingFacts(item.a, item.b)) {
      cache[key] = {
        predicted: false,
        reason: "blocked_by_guard",
      };
    } else {
        // Stay below Gemini's free-tier request limit.
        await new Promise(resolve =>
            setTimeout(resolve, REQUEST_DELAY_MS)
        );

        // For this pairwise experiment, B is the single candidate.
        const result = await judge(item.a, [
            { index: 0, text: item.b },
        ]);
        if (result.reason === "judge_unavailable") {
            throw new Error(
            `Judge unavailable at pair ${i + 1}. Previous results are saved.`
            );
        }

        cache[key] = {
            predicted: result.match === 0,
            reason: result.reason,
        };
    }

    completed++;

    // Persist every completed decision.
    await fs.writeFile(
      RESULT_PATH,
      JSON.stringify(cache, null, 2),
      "utf8"
    );

    console.log(`[${completed}/${dataset.length}] Evaluated pair ${i + 1}`);
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  dataset.forEach((item, index) => {
    const predicted = cache[String(index)].predicted;

    if (predicted && item.duplicate) tp++;
    else if (predicted && !item.duplicate) fp++;
    else if (!predicted && item.duplicate) fn++;
    else tn++;
  });

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);

  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  console.log("\n===== CONFIGURATION C RESULTS =====");
  console.log(`TP: ${tp} | FP: ${fp} | FN: ${fn} | TN: ${tn}`);
  console.log(`Precision: ${(precision * 100).toFixed(2)}%`);
  console.log(`Recall: ${(recall * 100).toFixed(2)}%`);
  console.log(`F1: ${(f1 * 100).toFixed(2)}%`);
  console.log(`False merges: ${fp}`);
  console.log(`Missed duplicates: ${fn}`);
}

main().catch(error => {
  console.error("Judge evaluation failed:", error);
  process.exit(1);
});
