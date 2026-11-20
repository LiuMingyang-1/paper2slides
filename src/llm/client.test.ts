import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnnaHost } from "../anna";
import { PROMPTS } from "../prompts/generated";
import { understandingValidator } from "../schema/understanding";
import type { LlmCallLog, Understanding } from "../types";
import { createLlmClient, type LlmClientOptions } from "./client";
import { fakeHost, reply } from "./test-fixtures";

const understanding: Understanding = {
  title: "Example",
  oneLiner: 'Literal brackets { [ ] } and "quotes"',
  modules: [{ kind: "method", points: [{ text: "The paper uses a CNN.", kind: "fact", evidenceIds: ["e3-5"] }] }],
};
const vars = {
  language: "en", mode: "full", detail: "full", paper_metadata: "Example", evidence_blocks: "[e3-5] (p.3) A CNN.",
};
const valid = JSON.stringify(understanding);

function setup(options: LlmClientOptions = {}) {
  const complete = vi.fn<AnnaHost["llm"]["complete"]>().mockResolvedValue(reply(valid));
  const logs: LlmCallLog[] = [];
  const client = createLlmClient(fakeHost(complete), { ...options, onCall: (log) => logs.push(log) });
  const run = () => client.complete(PROMPTS.understand!, vars, understandingValidator(new Set(["e3-5"])));
  return { run, complete, logs };
}

afterEach(() => vi.useRealTimers());

describe("Anna completion client", () => {
  it.each([
    ["JSON fence", `Here is the response:\n\n\`\`\`json\n${valid}\n\`\`\`\nThanks.`],
    ["surrounding prose", `[Note] Result: ${valid}\nEnd.`],
  ])("reads %s without retry", async (_label, text) => {
    const { run, complete, logs } = setup();
    complete.mockResolvedValueOnce(reply(text));
    await expect(run()).resolves.toEqual(understanding);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![0]).not.toHaveProperty("responseFormat");
    expect(logs).toMatchObject([{
      promptId: "understand", promptVersion: 1, attempt: 1, ok: true,
      quotaConsumed: 3, inputTokens: 100, outputTokens: 20, latencyMs: 17, stopReason: "endTurn",
    }]);
  });

  it.each([
    ["malformed JSON", '{"title": "No close"', "endTurn", "JSON"],
    ["schema mismatch", '{"title":"Example","oneLiner":"Short"}', "endTurn", "modules"],
    ["truncated output", valid, "maxTokens", "token 上限"],
  ])("repairs %s once with targeted feedback", async (_case, text, stopReason, expectedFeedback) => {
    const { run, complete, logs } = setup();
    complete.mockResolvedValueOnce(reply(text, stopReason));
    await expect(run()).resolves.toEqual(understanding);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]![0].messages[1]?.content).toContain(expectedFeedback);
    expect(logs).toMatchObject([
      { attempt: 1, ok: false, stopReason, quotaConsumed: 3 },
      { attempt: 2, ok: true, stopReason: "endTurn", quotaConsumed: 3 },
    ]);
  });

  it("rejects a second invalid output without accepting a nested JSON fragment", async () => {
    const { run, complete, logs } = setup();
    complete.mockResolvedValue(reply(`{"wrapper":${valid},}`));
    await expect(run()).rejects.toMatchObject({ code: "invalid_output", message: "未找到格式正确的 JSON。" });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(logs.every(({ ok }) => !ok)).toBe(true);
  });

  it("preserves validly formatted but missing evidence IDs and logs them", async () => {
    const { run, complete, logs } = setup({ responseFormat: { type: "json_object" } });
    complete.mockResolvedValueOnce(reply(valid.replace("e3-5", "e99-0")));
    await expect(run()).resolves.toMatchObject({ modules: [{ points: [{ evidenceIds: ["e99-0"] }] }] });
    expect(complete.mock.calls[0]![0].responseFormat).toEqual({ type: "json_object" });
    expect(logs[0]?.missingEvidenceIds).toEqual(["e99-0"]);
  });

  it("keeps raw output and normalization warnings for each attempt", async () => {
    const { run, complete, logs } = setup();
    const modelOutput = (evidenceId: string) => JSON.stringify({
      ...understanding,
      modules: [{ kind: "method", title: "CNN", points: [
        { text: "The paper uses a CNN.", type: "fact", evidence_ids: evidenceId },
      ] }],
    });
    const invalidOutput = modelOutput("Figure 2");
    const validOutput = `\`\`\`json\n${modelOutput("e3-5")}\n\`\`\`\n${"𠀀".repeat(8000)}`;
    complete.mockResolvedValueOnce(reply(invalidOutput)).mockResolvedValueOnce(reply(validOutput));
    await expect(run()).resolves.toEqual(understanding);
    expect(logs).toMatchObject([
      { ok: false, rawOutput: invalidOutput, error: expect.stringContaining("evidenceIds[0]") },
      { ok: true, rawOutput: Array.from(validOutput).slice(0, 8000).join("") },
    ]);
    for (const log of logs) {
      expect(log.normalizations).toEqual([
        "丢弃字段 modules[0].title",
        "字段 modules[0].points[0].type 映射为 kind",
        "字段 modules[0].points[0].evidence_ids 映射为 evidenceIds",
        "modules[0].points[0].evidenceIds 转为数组",
      ]);
    }
    const feedback = complete.mock.calls[1]![0].messages[1]?.content;
    expect(feedback).toContain(logs[0]?.error);
    expect(feedback).toContain("只输出约定字段、不要添加其他字段");
  });

  it.each(["quota_exceeded", "invalid_arg", "not_implemented"])("does not retry host error %s", async (code) => {
    const { run, complete, logs } = setup();
    complete.mockRejectedValueOnce(Object.assign(new Error("HostRpcError"), { code }));
    await expect(run()).rejects.toMatchObject({
      code: code === "quota_exceeded" ? code : "host",
      message: expect.stringContaining(code === "quota_exceeded" ? "额度不足" : code),
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(logs).toMatchObject([{ ok: false, quotaConsumed: null, stopReason: null }]);
  });

  it("bounds hung requests and backs off at 10 and 20 ms before stopping", async () => {
    vi.useFakeTimers();
    const { run, complete, logs } = setup({ timeoutMs: 50, retryDelayMs: 10 });
    complete.mockImplementation(() => new Promise(() => {}));
    const assertion = expect(run()).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(59);
    expect(complete).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(complete).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(69);
    expect(complete).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(complete).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(complete.mock.calls.every(([, options]) => options?.timeoutMs === 50)).toBe(true);
    expect(logs.map(({ latencyMs, ok }) => [latencyMs, ok])).toEqual([[50, false], [50, false], [50, false]]);
  });

  it("retains repair instructions through a transport retry", async () => {
    const { run, complete, logs } = setup({ retryDelayMs: 0 });
    complete.mockResolvedValueOnce(reply("bad JSON"))
      .mockRejectedValueOnce(Object.assign(new Error("transport failure"), { code: "network_error" }));
    await expect(run()).resolves.toEqual(understanding);
    expect(complete.mock.calls[2]![0].messages).toEqual(complete.mock.calls[1]![0].messages);
    expect(logs.map(({ ok }) => ok)).toEqual([false, false, true]);
  });
});
