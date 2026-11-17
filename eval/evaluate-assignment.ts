
import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

import { InMemoryStore } from "../src/lib/store";
import { assignQuestion } from "../src/lib/assign";
import { judge } from "../src/lib/judge";

type DatasetRecord = {
  a: string;
  b: string;
  duplicate: boolean;
  topic: string;
};

type GroundTruthRecord = {
  pairIndex: number;
  topic: string;
  incomingQuestion: string;
  expectedClusterId: string | null;
  assignmentStatus: "CONFIRMED_MATCH" | "CREATE";
};

type EvaluationResult = {
  pairIndex: number;
  topic: string;
  incomingQuestion: string;
  expectedStatus: "JOIN" | "CREATE";
  expectedClusterId: string | null;
  predictedStatus: "JOIN" | "CREATE";
  predictedClusterId: string | null;
  decision: "JOINED" | "CREATED";
  stage: string;
  reason: string;
  clusterCorrect: boolean | null;
  durationMs: number;
};

const DATASET_PATH = path.join(
  process.cwd(),
  "eval/dataset.jsonl"
);

const GROUND_TRUTH_PATH = path.join(
  process.cwd(),
  "eval/assignment-ground-truth.json"
);

const EMBEDDINGS_PATH = path.join(
  process.cwd(),
  "eval/embeddings-cache.json"
);

const RESULTS_PATH = path.join(
  process.cwd(),
  "eval/assignment-results.json"
);

async function main() {
  loadEnvConfig(process.cwd());

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing from .env.local");
  }

  const dataset: DatasetRecord[] = (
    await fs.readFile(DATASET_PATH, "utf8")
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const readJson = async <T>(filePath: string): Promise<T> => {
  const content = await fs.readFile(filePath, "utf8");

    return JSON.parse(
        content.replace(/^\uFEFF/, "")
    ) as T;
  };

    const groundTruth = await readJson<GroundTruthRecord[]>(
        GROUND_TRUTH_PATH
    );

    const embeddings = await readJson<Record<string, number[]>>(
        EMBEDDINGS_PATH
    );

  // Build canonical pools exactly as in retrieval preparation.
  const canonicalPools = new Map<
    string,
    { text: string; benchmarkId: string }[]
  >();

  dataset.forEach((item, index) => {
    if (!canonicalPools.has(item.topic)) {
      canonicalPools.set(item.topic, []);
    }

    const pool = canonicalPools.get(item.topic)!;

    if (!pool.some((canonical) => canonical.text === item.a)) {
      pool.push({
        text: item.a,
        benchmarkId: `cluster-${index}`,
      });
    }
  });

  // Validate all incoming and canonical embeddings.
  for (const item of dataset) {
    if (!embeddings[item.a] || !embeddings[item.b]) {
      throw new Error(
        `Missing cached embedding: ${!embeddings[item.a] ? item.a : item.b}`
      );
    }
  }

  // Resume previously completed cases.
  let results: EvaluationResult[] = [];

  try {
    results = JSON.parse(
      await fs.readFile(RESULTS_PATH, "utf8")
    );
  } catch {
    results = [];
  }

  const completed = new Set(
    results.map((result) => result.pairIndex)
  );

  console.log("\n===== EVENT-LEVEL ASSIGNMENT EVALUATION =====");
  console.log(`Total cases: ${groundTruth.length}`);
  console.log(`Already completed: ${completed.size}`);
  console.log(`Remaining: ${groundTruth.length - completed.size}`);
  // Keep Gemini judge requests below the free-tier rate limit.
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

let lastJudgeCallAt = 0;

const rateLimitedJudge: typeof judge = async (...args) => {
  const minimumInterval = 12_000;

  const elapsed = Date.now() - lastJudgeCallAt;
  const waitTime = Math.max(0, minimumInterval - elapsed);

  if (waitTime > 0) {
    console.log(`Waiting ${(waitTime / 1000).toFixed(1)}s before Gemini judge...`);
    await sleep(waitTime);
  }

  lastJudgeCallAt = Date.now();

  return judge(...args);
};

  for (const truth of groundTruth) {
    if (completed.has(truth.pairIndex)) {
      continue;
    }

    const startTime = Date.now();

    // A fresh store ensures each case sees only original A canonicals.
    const store = new InMemoryStore();
    const benchmarkIdByStoreId = new Map<string, string>();

    const canonicals = canonicalPools.get(truth.topic);

    if (!canonicals) {
      throw new Error(`Missing canonical pool: ${truth.topic}`);
    }

    // Seed original canonical questions in dataset order.
    for (const canonical of canonicals) {
      const storeId = await store.createCluster(
        truth.topic,
        canonical.text,
        embeddings[canonical.text],
        {
          questionId: `seed-question-${canonical.benchmarkId}`,
          authorId: "benchmark-seed",
          requestId: `seed-${canonical.benchmarkId}`,
          similarity: 1,
        }
      );

      benchmarkIdByStoreId.set(
        storeId,
        canonical.benchmarkId
      );
    }

    // Inject cached embeddings. No embedding API calls.
    const result = await assignQuestion(
  store,
  truth.topic,
  truth.incomingQuestion,
  {
    questionId: `evaluation-question-${truth.pairIndex}`,
    authorId: "evaluation-user",
    requestId: `evaluation-${truth.pairIndex}`,
  },
  {
    embed: async (text) => {
      const vector = embeddings[text];

      if (!vector) {
        throw new Error(`Embedding not cached: ${text}`);
      }

      return vector;
    },
    judge: rateLimitedJudge,
  }
);
        // Never save quota/API failures as valid evaluation predictions.
    if (result.stage === "judge_failed") {
      throw new Error(
        `Judge failed for pair ${truth.pairIndex}. ` +
        `Evaluation stopped. Previous valid results are preserved.`
      );
    }

    const predictedStatus =
      result.decision === "JOINED" ? "JOIN" : "CREATE";

    const predictedClusterId =
      result.decision === "JOINED"
        ? benchmarkIdByStoreId.get(result.clusterId) ?? null
        : null;

    const expectedStatus =
      truth.assignmentStatus === "CONFIRMED_MATCH"
        ? "JOIN"
        : "CREATE";

    const clusterCorrect =
      expectedStatus === "JOIN" && predictedStatus === "JOIN"
        ? predictedClusterId === truth.expectedClusterId
        : null;

    const evaluationResult: EvaluationResult = {
      pairIndex: truth.pairIndex,
      topic: truth.topic,
      incomingQuestion: truth.incomingQuestion,
      expectedStatus,
      expectedClusterId: truth.expectedClusterId,
      predictedStatus,
      predictedClusterId,
      decision: result.decision,
      stage: result.stage,
      reason: result.reason,
      clusterCorrect,
      durationMs: Date.now() - startTime,
    };

    results.push(evaluationResult);
    completed.add(truth.pairIndex);

    // Save after every case for safe resumption.
    await fs.writeFile(
      RESULTS_PATH,
      JSON.stringify(results, null, 2),
      "utf8"
    );

    console.log(
      `[${completed.size}/${groundTruth.length}] ` +
      `Pair ${truth.pairIndex}: ` +
      `${expectedStatus} -> ${predictedStatus} | ` +
      `${result.stage} | ${evaluationResult.durationMs}ms`
    );
  }

  // Calculate assignment metrics.
  const tp = results.filter(
    (r) => r.expectedStatus === "JOIN" &&
      r.predictedStatus === "JOIN"
  ).length;

  const fp = results.filter(
    (r) => r.expectedStatus === "CREATE" &&
      r.predictedStatus === "JOIN"
  ).length;

  const fn = results.filter(
    (r) => r.expectedStatus === "JOIN" &&
      r.predictedStatus === "CREATE"
  ).length;

  const tn = results.filter(
    (r) => r.expectedStatus === "CREATE" &&
      r.predictedStatus === "CREATE"
  ).length;

  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall
    ? (2 * precision * recall) / (precision + recall)
    : 0;

  const matchedCases = results.filter(
    (r) => r.expectedStatus === "JOIN" &&
      r.predictedStatus === "JOIN"
  );

  const correctClusters = matchedCases.filter(
    (r) => r.clusterCorrect
  ).length;

  const wrongClusters = matchedCases.length - correctClusters;

  const stageCounts = Object.entries(
    results.reduce<Record<string, number>>((counts, result) => {
      counts[result.stage] = (counts[result.stage] || 0) + 1;
      return counts;
    }, {})
  );

  console.log("\n========== FINAL RESULTS ==========");
  console.log(`Total: ${results.length}`);
  console.log(`TP: ${tp}`);
  console.log(`FP (false merges): ${fp}`);
  console.log(`FN (missed duplicates): ${fn}`);
  console.log(`TN: ${tn}`);
  console.log(`Precision: ${(precision * 100).toFixed(2)}%`);
  console.log(`Recall: ${(recall * 100).toFixed(2)}%`);
  console.log(`F1: ${(f1 * 100).toFixed(2)}%`);
  console.log(`Correct cluster assignments: ${correctClusters}`);
  console.log(`Wrong cluster assignments: ${wrongClusters}`);

  console.log("\nStage distribution:");
  for (const [stage, count] of stageCounts) {
    console.log(`${stage}: ${count}`);
  }

  console.log(`\nResults saved to: ${RESULTS_PATH}`);
}

main().catch((error) => {
  console.error("Assignment evaluation failed:", error);
  process.exit(1);
});
