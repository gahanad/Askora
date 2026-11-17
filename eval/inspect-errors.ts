
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

type EvaluationResult = {
  predicted: boolean;
  reason: string;
};

interface ErrorDetails {
  pair: number;
  a: string;
  b: string;
  topic: string;
  reason: string;
}

async function main() {
  const dataset: DatasetRecord[] = (
    await fs.readFile(
      path.join(process.cwd(), "eval/dataset.jsonl"),
      "utf8"
    )
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));

  const cache: Record<string, EvaluationResult> =
    JSON.parse(
      await fs.readFile(
        path.join(process.cwd(), "eval/judge-results.json"),
        "utf8"
      )
    );

  const falseMerges: ErrorDetails[] = [];
  const missedDuplicates: ErrorDetails[] = [];

  dataset.forEach((item, index) => {
    const result = cache[String(index)];

    if (!result) {
      console.log(`Missing result for pair ${index + 1}`);
      return;
    }

    const details = {
      pair: index + 1,
      a: item.a,
      b: item.b,
      topic: item.topic,
      reason: result.reason,
    };

    if (result.predicted && !item.duplicate) {
      falseMerges.push(details);
    }

    if (!result.predicted && item.duplicate) {
      missedDuplicates.push(details);
    }
  });

  console.log("\n===== CONFIGURATION C: FALSE MERGES =====");

  falseMerges.forEach(item => {
    console.log(`\nPair ${item.pair} | ${item.topic}`);
    console.log(`A: ${item.a}`);
    console.log(`B: ${item.b}`);
    console.log(`Judge reason: ${item.reason}`);
  });

  console.log("\n===== CONFIGURATION C: MISSED DUPLICATES =====");

  missedDuplicates.forEach(item => {
    console.log(`\nPair ${item.pair} | ${item.topic}`);
    console.log(`A: ${item.a}`);
    console.log(`B: ${item.b}`);
    console.log(`Judge reason: ${item.reason}`);
  });

  console.log("\n===== SUMMARY =====");
  console.log(`False merges: ${falseMerges.length}`);
  console.log(`Missed duplicates: ${missedDuplicates.length}`);
}

main().catch(error => {
  console.error("Error inspection failed:", error);
  process.exit(1);
});
