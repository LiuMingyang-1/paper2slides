// Thin typed facade over the host-served Anna App SDK.
// In production the SDK is at /static/anna-apps/_sdk/latest/index.js (served by host).
// Everything else in the app talks to the host ONLY through `AnnaHost`, so tests can
// inject a fake.

export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string | { type: "text"; text: string };
}

export interface LlmCompleteArgs {
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** Unverified on the iframe surface — see DESIGN.md §12. */
  responseFormat?: { type: "json_object" } | { type: "json_schema"; json_schema: unknown };
}

export interface LlmCompleteResult {
  role: "assistant";
  content: { type: "text"; text: string };
  model: string;
  stopReason: "endTurn" | "maxTokens" | "contentFilter" | "toolUse" | string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  _meta?: { latencyMs?: number; quotaConsumed?: number; maxTokens?: { effective: number } };
}

export interface EmbedResult {
  model: string;
  data: Array<{ index: number; embedding: number[] }>;
  _meta?: { quotaConsumed?: number; dimensions?: number };
}

export interface UploadResult {
  download_url: string;
  bytes_size: number;
  expires_in: number;
}

export interface AnnaHost {
  llm: {
    complete(args: LlmCompleteArgs, opts?: { timeoutMs?: number }): Promise<LlmCompleteResult>;
    embed(args: { input: string | string[] }, opts?: { timeoutMs?: number }): Promise<EmbedResult>;
  };
  storage: {
    get(args: { key: string }): Promise<{ value?: unknown } | unknown>;
    set(args: { key: string; value: unknown }): Promise<unknown>;
  };
  upload: {
    inline(args: { filename: string; mime_type: string; content_b64: string }): Promise<UploadResult>;
  };
  window: { set_title(args: { title: string }): Promise<unknown> };
}

const SDK_URL = "/static/anna-apps/_sdk/latest/index.js";

let cached: AnnaHost | null = null;

/** Connects to the host; returns null when running standalone (no host). */
export async function connectAnna(): Promise<AnnaHost | null> {
  if (cached) return cached;
  try {
    const mod = await import(/* @vite-ignore */ SDK_URL);
    cached = (await mod.AnnaAppRuntime.connect()) as AnnaHost;
    return cached;
  } catch {
    return null;
  }
}

/** Error thrown by host RPCs carries a `code` (e.g. quota_exceeded). */
export function hostErrorCode(e: unknown): string | undefined {
  const c = (e as { code?: unknown })?.code;
  return typeof c === "string" ? c : undefined;
}
