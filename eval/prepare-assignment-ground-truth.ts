
import fs from "node:fs/promises";
import path from "node:path";

type DatasetRecord = {
  a: string;
  b: string;
  duplicate: boolean;
  topic: string;
};

type RetrievalCase = {
  pairIndex: number;
  topic: string;
  incomingQuestion: string;
  expectedClusterId: string | null;
  candidates: {
    clusterId: string;
    text: string;
    score: number;
  }[];
};

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

  const retrievalCases: RetrievalCase[] = JSON.parse(
    await fs.readFile(
      path.join(process.cwd(), "eval/retrieval-cases.json"),
      "utf8"
    )
  );

  const groundTruth = retrievalCases.map((item, index) => {
    const original = dataset[index];

    return {
      pairIndex: index,
      topic: item.topic,
      incomingQuestion: item.incomingQuestion,

      expectedClusterId: original.duplicate
        ? item.expectedClusterId
        : null,

      assignmentStatus: original.duplicate
        ? "CONFIRMED_MATCH"
        : "NEEDS_REVIEW",

      candidates: item.candidates
    };
  });

  const outputPath = path.join(
    process.cwd(),
    "eval/assignment-ground-truth.json"
  );

  await fs.writeFile(
    outputPath,
    JSON.stringify(groundTruth, null, 2),
    "utf8"
  );

  console.log("===== ASSIGNMENT GROUND TRUTH =====");
  console.log(`Total cases: ${groundTruth.length}`);
  console.log(
    `Confirmed matches: ${
      groundTruth.filter(x => x.assignmentStatus === "CONFIRMED_MATCH").length
    }`
  );
  console.log(
    `Needs review: ${
      groundTruth.filter(x => x.assignmentStatus === "NEEDS_REVIEW").length
    }`
  );
  console.log(`Saved to: ${outputPath}`);
}

main().catch(error => {
  console.error("Ground-truth preparation failed:", error);
  process.exit(1);
});
