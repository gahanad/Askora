
import type {
  JudgeCandidate,
  JudgeResult,
} from "./llm/types";

import {
  JUDGE_PROMPT_VERSION,
  buildJudgePrompt,
} from "./llm/prompt";

import {
  runJudgeWithFallback,
} from "./llm/provider";

const CACHE_LIMIT = 500;

const judgeCache = new Map<string, JudgeResult>();

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function createCacheKey(
  newQuestion: string,
  candidates: JudgeCandidate[]
): string {
  return JSON.stringify({
    version: JUDGE_PROMPT_VERSION,
    question: normalizeQuestion(newQuestion),
    candidates: candidates.map((candidate) => ({
      index: candidate.index,
      text: normalizeQuestion(candidate.text),
    })),
  });
}

function validateResult(
  value: unknown,
  candidates: JudgeCandidate[]
): JudgeResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("match" in value) ||
    !("reason" in value)
  ) {
    return {
      match: null,
      reason: "invalid_response",
    };
  }

  const result = value as {
    match: unknown;
    reason: unknown;
  };

  if (typeof result.reason !== "string") {
    return {
      match: null,
      reason: "invalid_response",
    };
  }

  if (
    result.match !== null &&
    (
      !Number.isInteger(result.match) ||
      !candidates.some(
        (candidate) => candidate.index === result.match
      )
    )
  ) {
    return {
      match: null,
      reason: "invalid_index",
    };
  }

  return {
    match: result.match as number | null,
    reason: result.reason.slice(0, 150),
  };
}

function cacheResult(
  cacheKey: string,
  result: JudgeResult
): void {
  if (judgeCache.size >= CACHE_LIMIT) {
    const oldestKey = judgeCache.keys().next().value;

    if (oldestKey) {
      judgeCache.delete(oldestKey);
    }
  }

  judgeCache.set(cacheKey, result);
}

export async function judge(
  newQuestion: string,
  candidates: JudgeCandidate[]
): Promise<JudgeResult> {
  if (!newQuestion.trim()) {
    return {
      match: null,
      reason: "empty_question",
    };
  }

  if (candidates.length === 0) {
    return {
      match: null,
      reason: "no_candidates",
    };
  }

  if (
    candidates.length > 3 ||
    candidates.some(
      (candidate) =>
        !Number.isInteger(candidate.index) ||
        !candidate.text.trim()
    ) ||
    new Set(
      candidates.map((candidate) => candidate.index)
    ).size !== candidates.length
  ) {
    return {
      match: null,
      reason: "invalid_candidates",
    };
  }

  const cacheKey = createCacheKey(
    newQuestion,
    candidates
  );

  const cached = judgeCache.get(cacheKey);

  if (cached) {
    return { ...cached };
  }

  const prompt = buildJudgePrompt(
    newQuestion,
    candidates
  );

  try {
    const execution = await runJudgeWithFallback(
      prompt,
      (value) => validateResult(value, candidates)
    );

    console.info(
      `Question judged successfully using ${execution.provider}.`
    );

    cacheResult(cacheKey, execution.result);

    return execution.result;
  } catch (error) {
    console.error("All judge processing failed:", error);

    return {
      match: null,
      reason: "judge_unavailable",
    };
  }
}
