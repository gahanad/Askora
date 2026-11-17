
import fs from "node:fs/promises";
import path from "node:path";

type EvaluationResult = {
  pairIndex: number;
  topic: string;
  expectedStatus: "JOIN" | "CREATE";
  expectedClusterId: string | null;
  predictedStatus: "JOIN" | "CREATE";
  predictedClusterId: string | null;
  clusterCorrect: boolean | null;
};

type EquivalenceGroup = {
  groupId: string;
  topic: string;
  clusterIds: string[];
};

const RESULTS_PATH = path.join(
  process.cwd(),
  "eval/assignment-results.json"
);

const GROUPS_PATH = path.join(
  process.cwd(),
  "eval/canonical-equivalence-groups.json"
);

const OUTPUT_PATH = path.join(
  process.cwd(),
  "eval/assignment-equivalence-results.json"
);

async function readJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content.replace(/^\uFEFF/, "")) as T;
}

async function main() {
  const results = await readJson<EvaluationResult[]>(
    RESULTS_PATH
  );

  const groups = await readJson<EquivalenceGroup[]>(
    GROUPS_PATH
  );

  // Map each topic + canonical cluster ID to its equivalence group.
  const groupByCluster = new Map<string, string>();

  for (const group of groups) {
    for (const clusterId of group.clusterIds) {
      const key = `${group.topic}:${clusterId}`;

      if (groupByCluster.has(key)) {
        throw new Error(
          `Cluster belongs to multiple groups: ${key}`
        );
      }

      groupByCluster.set(key, group.groupId);
    }
  }

  function equivalent(
    topic: string,
    expectedId: string | null,
    predictedId: string | null
  ): boolean {
    if (!expectedId || !predictedId) {
      return false;
    }

    // Exact match is always correct.
    if (expectedId === predictedId) {
      return true;
    }

    const expectedGroup = groupByCluster.get(
      `${topic}:${expectedId}`
    );

    const predictedGroup = groupByCluster.get(
      `${topic}:${predictedId}`
    );

    return (
      expectedGroup !== undefined &&
      expectedGroup === predictedGroup
    );
  }

  const matchedCases = results.filter(
    result =>
      result.expectedStatus === "JOIN" &&
      result.predictedStatus === "JOIN"
  );

  const exactCorrect = matchedCases.filter(
    result =>
      result.expectedClusterId === result.predictedClusterId
  ).length;

  const equivalenceCorrect = matchedCases.filter(
    result =>
      equivalent(
        result.topic,
        result.expectedClusterId,
        result.predictedClusterId
      )
  ).length;

  const equivalenceOnlyCorrect =
    equivalenceCorrect - exactCorrect;

  const incorrect = matchedCases.length - equivalenceCorrect;

  const caseResults = matchedCases.map(result => ({
    pairIndex: result.pairIndex,
    topic: result.topic,
    expectedClusterId: result.expectedClusterId,
    predictedClusterId: result.predictedClusterId,
    exactMatch:
      result.expectedClusterId === result.predictedClusterId,
    equivalenceMatch: equivalent(
      result.topic,
      result.expectedClusterId,
      result.predictedClusterId
    ),
  }));

  const exactAccuracy = matchedCases.length
    ? exactCorrect / matchedCases.length
    : 0;

  const equivalenceAccuracy = matchedCases.length
    ? equivalenceCorrect / matchedCases.length
    : 0;

  const output = {
    totalCases: results.length,
    matchedCases: matchedCases.length,
    equivalenceGroups: groups.length,
    exactCorrect,
    equivalenceOnlyCorrect,
    equivalenceCorrect,
    incorrect,
    exactClusterAccuracy: Number(
      (exactAccuracy * 100).toFixed(2)
    ),
    equivalenceAwareClusterAccuracy: Number(
      (equivalenceAccuracy * 100).toFixed(2)
    ),
    cases: caseResults,
  };

  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log("\n===== EQUIVALENCE-AWARE EVALUATION =====");
  console.log(`Total evaluation cases: ${results.length}`);
  console.log(`JOIN predictions on positive cases: ${matchedCases.length}`);
  console.log(`Exact cluster matches: ${exactCorrect}`);
  console.log(`Additional matches via equivalence: ${equivalenceOnlyCorrect}`);
  console.log(`Total correct cluster assignments: ${equivalenceCorrect}`);
  console.log(`Incorrect cluster assignments: ${incorrect}`);
  console.log(
    `Exact cluster accuracy: ${output.exactClusterAccuracy}%`
  );
  console.log(
    `Equivalence-aware cluster accuracy: ${output.equivalenceAwareClusterAccuracy}%`
  );

  console.log(`\nSaved to: ${OUTPUT_PATH}`);
}

main().catch(error => {
  console.error("Equivalence evaluation failed:", error);
  process.exit(1);
});
