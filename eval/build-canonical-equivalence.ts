
import fs from "node:fs/promises";
import path from "node:path";

type ReviewPair = {
  topic: string;
  question1: {
    clusterId: string;
    text: string;
  };
  question2: {
    clusterId: string;
    text: string;
  };
  score: number;
  sameIntent: boolean | null;
};

const INPUT_PATH = path.join(
  process.cwd(),
  "eval/canonical-equivalence-review.json"
);

const OUTPUT_PATH = path.join(
  process.cwd(),
  "eval/canonical-equivalence-groups.json"
);

function main() {
  return fs.readFile(INPUT_PATH, "utf8").then(async content => {
    const pairs: ReviewPair[] = JSON.parse(content);

    const parent = new Map<string, string>();

    function find(id: string): string {
      if (!parent.has(id)) parent.set(id, id);

      if (parent.get(id) !== id) {
        parent.set(id, find(parent.get(id)!));
      }

      return parent.get(id)!;
    }

    function union(a: string, b: string) {
      const rootA = find(a);
      const rootB = find(b);

      if (rootA !== rootB) {
        parent.set(rootB, rootA);
      }
    }

    // Process all approved equivalent pairs.
    for (const pair of pairs) {
      if (pair.sameIntent === null) {
        throw new Error(
          `Unreviewed pair: ${pair.question1.clusterId} / ${pair.question2.clusterId}`
        );
      }

      if (pair.sameIntent) {
        if (pair.topic !== pair.topic) {
          throw new Error("Topic mismatch");
        }

        union(
          `${pair.topic}:${pair.question1.clusterId}`,
          `${pair.topic}:${pair.question2.clusterId}`
        );
      }
    }

    // Check whether any explicitly different pair
    // ended up in the same equivalence group.
    const conflicts = pairs.filter(pair =>
      pair.sameIntent === false &&
      find(`${pair.topic}:${pair.question1.clusterId}`) ===
      find(`${pair.topic}:${pair.question2.clusterId}`)
    );

    if (conflicts.length > 0) {
      console.log("\nCONFLICTS FOUND:");
      conflicts.forEach(pair => {
        console.log(
          `\n${pair.question1.clusterId}: ${pair.question1.text}`
        );
        console.log(
          `${pair.question2.clusterId}: ${pair.question2.text}`
        );
      });

      throw new Error(
        `${conflicts.length} contradictory equivalence relationships found. Resolve them before generating the mapping.`
      );
    }

    // Collect equivalence groups.
    const groups = new Map<
      string,
      { topic: string; clusterIds: Set<string> }
    >();

    for (const pair of pairs) {
      if (!pair.sameIntent) continue;

      const key = `${pair.topic}:${find(
        `${pair.topic}:${pair.question1.clusterId}`
      )}`;

      if (!groups.has(key)) {
        groups.set(key, {
          topic: pair.topic,
          clusterIds: new Set(),
        });
      }

      const group = groups.get(key)!;
      group.clusterIds.add(pair.question1.clusterId);
      group.clusterIds.add(pair.question2.clusterId);
    }

    const output = [...groups.values()].map((group, index) => ({
      groupId: `equivalence-${index + 1}`,
      topic: group.topic,
      clusterIds: [...group.clusterIds].sort(),
    }));

    await fs.writeFile(
      OUTPUT_PATH,
      JSON.stringify(output, null, 2),
      "utf8"
    );

    console.log("\n===== EQUIVALENCE MAPPING =====");
    console.log(`Reviewed pairs: ${pairs.length}`);
    console.log(`Equivalent groups: ${output.length}`);
    console.log(
      `Clusters covered: ${
        new Set(output.flatMap(group => group.clusterIds)).size
      }`
    );
    console.log(`Saved to: ${OUTPUT_PATH}`);
  });
}

main().catch(error => {
  console.error("Mapping generation failed:", error);
  process.exit(1);
});
