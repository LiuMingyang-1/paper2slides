import type { AnnaHost, LlmCompleteResult } from "../anna";

export function fakeHost(complete: AnnaHost["llm"]["complete"]): AnnaHost {
  const unexpected = async (): Promise<never> => {
    throw new Error("测试不应调用此 Anna 接口");
  };
  return {
    llm: { complete, embed: unexpected },
    storage: { get: unexpected, set: unexpected },
    upload: { inline: unexpected },
    window: { set_title: unexpected },
  };
}

export function reply(text: string, stopReason = "endTurn"): LlmCompleteResult {
  return {
    role: "assistant",
    model: "fake",
    content: { type: "text", text },
    stopReason,
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    _meta: { quotaConsumed: 3, latencyMs: 17 },
  };
}
