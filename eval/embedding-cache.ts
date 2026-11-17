
import fs from "node:fs/promises";
import path from "node:path";
import { generateEmbedding } from "../src/lib/embed";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type DatasetRecord = {
  a: string;
  b: string;
  duplicate: boolean;
  topic: string;
};

type EmbeddingCache = Record<string, number[]>;

const DATASET_PATH = path.join(process.cwd(), "eval/dataset.jsonl");
const CACHE_PATH = path.join(process.cwd(), "eval/embeddings-cache.json");

const CONCURRENCY = 5;

async function loadDataset(): Promise<DatasetRecord[]> {
  const content = await fs.readFile(DATASET_PATH, "utf8");

  return content
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as DatasetRecord);
}

async function loadCache(): Promise<EmbeddingCache> {
  try {
    return JSON.parse(await fs.readFile(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function saveCache(cache: EmbeddingCache) {
  await fs.writeFile(
    CACHE_PATH,
    JSON.stringify(cache, null, 2),
    "utf8"
  );
}


async function runWithConcurrency(
  questions: string[],
  cache: EmbeddingCache
) {
  let completed = 0;

  const sleep = (ms: number) =>
    new Promise(resolve => setTimeout(resolve, ms));

  for (const question of questions) {
    let success = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Stay comfortably below the free-tier request limit.
        await sleep(1200);

        cache[question] = await generateEmbedding(question);

        // Save immediately so successful embeddings are never lost.
        await saveCache(cache);

        completed++;
        console.log(
          `[${completed}/${questions.length}] Embedded and cached`
        );

        success = true;
        break;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        if (message.includes("429") && attempt < 3) {
          console.log("Rate limit reached. Waiting 65 seconds...");
          await sleep(65_000);
          continue;
        }

        console.error("Embedding failed:", question);
        throw error;
      }
    }

    if (!success) {
      throw new Error("Could not generate embedding.");
    }
  }
}


async function main() {
  const dataset = await loadDataset();
  const cache = await loadCache();

  const uniqueQuestions = [
    ...new Set(dataset.flatMap(item => [item.a, item.b]))
  ];

  const missingQuestions = uniqueQuestions.filter(
    question => !cache[question]
  );

  console.log(`Dataset pairs: ${dataset.length}`);
  console.log(`Unique questions: ${uniqueQuestions.length}`);
  console.log(`Cached questions: ${uniqueQuestions.length - missingQuestions.length}`);
  console.log(`Questions to embed: ${missingQuestions.length}`);

  if (missingQuestions.length === 0) {
    console.log("All embeddings are already cached.");
    return;
  }

  await runWithConcurrency(missingQuestions, cache);
  await saveCache(cache);

  console.log("\nEmbedding cache generated successfully.");
}

main().catch(error => {
  console.error("Embedding cache generation failed:", error);
  process.exit(1);
});
