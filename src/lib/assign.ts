
import { generateEmbedding } from "./embed";
import { findCandidates } from "./candidates";
import { conflictingFacts } from "./guard";
import { judge } from "./judge";
import { withDistributedLock } from "./distributed_lock";
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
async function assignQuestionUnlocked(
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
    } catch (error) {
      console.error("Embedding generation failed:", error);

      throw new Error(
        "EMBEDDING_UNAVAILABLE: Could not generate question embedding."
      );
    }
    // 2. Retrieve similar canonical questions.
    const candidates = await findCandidates(
      store,
      eventId,
      vector,
      { k: 5, minScore: 0.70 }
    );

    console.log("CANDIDATES FOUND:", {
      eventId,
      count: candidates.length,
      candidates: candidates.map(c => ({
        clusterId: c.clusterId,
        score: c.score,
        text: c.text,
      })),
    });

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

    // 4. Ask the LLM judge to evaluate the remaining candidates.
    let judgment;

    try {
      judgment = await dependencies.judge(
        text,
        safeCandidates.map((candidate, index) => ({
          index,
          text: candidate.text,
        }))
      );
    } catch (error) {
      console.error("Intent judge failed:", error);

      throw new Error(
        "JUDGE_UNAVAILABLE: Intent evaluation failed."
      );
    }

    if (judgment.reason === "judge_unavailable") {
      throw new Error(
        "JUDGE_UNAVAILABLE: All LLM judge providers failed."
      );
    }

    // 5. Join the matching cluster.
    if (judgment.match !== null) {
      const matchedCandidate = safeCandidates[judgment.match];

      if (!matchedCandidate) {
        throw new Error(
          "JUDGE_UNAVAILABLE: Judge returned an invalid candidate index."
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
  return withDistributedLock(
    `event:${eventId}:assignment`,
    () =>
      assignQuestionUnlocked(
        store,
        eventId,
        text,
        metadata,
        dependencies
      )
  );
}