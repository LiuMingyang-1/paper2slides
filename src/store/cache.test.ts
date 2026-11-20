import { describe, expect, it, vi } from "vitest";
import type { AnnaHost } from "../anna";
import { CACHE_BYTES, createCache, sha256 } from "./cache";

function storage() {
  let data: unknown;
  return {
    async get() { return { value: data }; },
    async set({ value }: Parameters<AnnaHost["storage"]["set"]>[0]) { data = structuredClone(value); },
  };
}

describe("Anna cache", () => {
  it("hashes PDF bytes by content", async () => {
    const input = new TextEncoder().encode("abc");
    expect(await sha256(input.buffer)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("serializes overlapping writes and restores prior steps after reload", async () => {
    const kv = storage();
    const set = vi.spyOn(kv, "set");
    const cache = createCache(kv);
    await Promise.all([cache.set("paper:understand@1:hash", { result: 1 }), cache.set("paper:outline@2:hash", [2])]);
    const restored = createCache(kv);
    expect(await restored.get("paper:understand@1:hash")).toEqual({ result: 1 });
    expect(await restored.get("paper:outline@2:hash")).toEqual([2]);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it("caps total UTF-8 storage and retains large or evicted entries in memory", async () => {
    const kv = storage();
    const cache = createCache(kv);
    const chunk = "引".repeat(36_000);
    const large = chunk.repeat(2);
    await cache.set("first", chunk);
    await cache.set("second", chunk);
    await cache.set("large", large);
    expect(await cache.get("first")).toBe(chunk);
    expect(await cache.get("large")).toBe(large);
    const wire = await kv.get();
    expect(new TextEncoder().encode(JSON.stringify(wire)).length).toBeLessThan(CACHE_BYTES);
    const restored = createCache(kv);
    expect(await restored.get("first")).toBeUndefined();
    expect(await restored.get("second")).toBe(chunk);
    expect(await restored.get("large")).toBeUndefined();
  });

  it("falls back to memory even when the host rejects reads and writes", async () => {
    const unavailable = vi.fn().mockRejectedValue(new Error("runtime_state unavailable"));
    const cache = createCache({ get: unavailable, set: unavailable });
    await cache.set("step", 17);
    expect(await cache.get("step")).toBe(17);
  });
});
