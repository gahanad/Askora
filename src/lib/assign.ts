
import { generateEmbedding } from "./embed";
import { findCandidates } from "./candidates";
import { conflictingFacts } from "./guard";
import { judge } from "./judge";
import type { ClusterStore, QuestionMetadata } from "./store";

type AssignmentDependencies = {
  embed: typeof generateEmbedding;
  judge: typeof judge;
};

type SubmissionMetadata = Omit<QuestionMetadata, "similarity">;

export type AssignmentResult = {
  questionId: string;
  clusterId: string;
  decision: "JOINED" | "CREATED";
  similarity: number;
  stage:
    | "embedding_failed"
    | "no_candidates"
    | "guard_blocked"
    | "judge_match"
    | "judge_no_match"
    | "judge_failed";
  reason: string;
};

export async function assignQuestion(
  store: ClusterStore,
  eventId: string,
  text: string,
  metadata: SubmissionMetadata,
  dependencies: AssignmentDependencies = {
    embed: generateEmbedding,
    judge,
  }
): Promise<AssignmentResult> {
  const startTime = Date.now();

  const createNewCluster = async (
    vector: number[],
    stage: AssignmentResult["stage"],
    reason: string
  ): Promise<AssignmentResult> => {
    const clusterId = await store.createCluster(
      eventId,
      text,
      vector,
      {
        ...metadata,
        similarity: 1,
      }
    );

    return {
      questionId: metadata.questionId,
      clusterId,
      decision: "CREATED",
      similarity: 1,
      stage,
      reason,
    };
  };

  try {
    // 1. Generate embedding.
    let vector: number[];

    try {
      vector = await dependencies.embed(text);
    } catch {
      return await createNewCluster(
        [],
        "embedding_failed",
        "Embedding generation failed."
      );
    }

    // 2. Retrieve similar canonical questions.
    const candidates = await findCandidates(
      store,
      eventId,
      vector,
      { k: 5, minScore: 0.70 }
    );

    if (candidates.length === 0) {
      return await createNewCluster(
        vector,
        "no_candidates",
        "No sufficiently similar candidates found."
      );
    }

    // 3. Remove candidates with conflicting facts.
    const safeCandidates = candidates.filter(
      candidate => !conflictingFacts(text, candidate.text)
    );

    if (safeCandidates.length === 0) {
      return await createNewCluster(
        vector,
        "guard_blocked",
        "All candidates contained conflicting facts."
      );
    }

    // 4. Ask Gemini to judge the remaining candidates.
    let judgment;

    try {
      judgment = await dependencies.judge(
        text,
        safeCandidates.map((candidate, index) => ({
          index,
          text: candidate.text,
        }))
      );
    } catch {
      return await createNewCluster(
        vector,
        "judge_failed",
        "Intent judge failed."
      );
    }

    if (judgment.reason === "judge_unavailable") {
      return await createNewCluster(
        vector,
        "judge_failed",
        "Gemini judge was unavailable."
      );
    }

    // 5. Join the matching cluster.
    if (judgment.match !== null) {
      const matchedCandidate = safeCandidates[judgment.match];

      if (!matchedCandidate) {
        return await createNewCluster(
          vector,
          "judge_no_match",
          "Judge returned an invalid candidate."
        );
      }

      await store.addToCluster(
        matchedCandidate.clusterId,
        text,
        vector,
        {
          ...metadata,
          similarity: matchedCandidate.score,
        }
      );

      return {
        questionId: metadata.questionId,
        clusterId: matchedCandidate.clusterId,
        decision: "JOINED",
        similarity: matchedCandidate.score,
        stage: "judge_match",
        reason: judgment.reason,
      };
    }

    // 6. No matching intent: create a new cluster.
    return await createNewCluster(
      vector,
      "judge_no_match",
      judgment.reason
    );
  } finally {
    console.log(
      JSON.stringify({
        operation: "question_assignment",
        eventId,
        durationMs: Date.now() - startTime,
      })
    );
  }
}
