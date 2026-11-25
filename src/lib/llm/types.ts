
export type JudgeCandidate = {
  index: number;
  text: string;
};

export type JudgeResult = {
  match: number | null;
  reason: string;
};

export type JudgeProviderName = "groq" | "gemini";

export type JudgeProvider = {
  name: JudgeProviderName;

  judge(
    prompt: string
  ): Promise<string>;
};

export type JudgeFailureReason =
  | "timeout"
  | "rate_limit"
  | "server_error"
  | "authentication_error"
  | "invalid_response"
  | "provider_error";
