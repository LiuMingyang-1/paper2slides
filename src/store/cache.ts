import type { AnnaHost } from "../anna";
import type { PipelineCache } from "../pipeline/pipeline";

const KEY = "paper2slides-cache-v1";
// Anna's entire runtime_state is limited to 256 KiB. Leave room for the key and RPC metadata.
export const CACHE_BYTES = 180 * 1024;

function wireSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify({ key: KEY, value })).length;
}

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createCache(storage?: AnnaHost["storage"]): PipelineCache {
  const memory = new Map<string, unknown>();
  const saved = new Map<string, unknown>();
  const ready = (async () => {
    if (!storage) return;
    try {
      const response = await storage.get({ key: KEY });
      const value = response && typeof response === "object" && "value" in response ? response.value : response;
      if (!Array.isArray(value) || wireSize(value) > CACHE_BYTES) return;
      for (const entry of value) {
        if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string") saved.set(entry[0], entry[1]);
      }
    } catch {
      // A storage failure must not prevent use of the session cache.
    }
  })();
  let writes = ready;
  return {
    async get(key) {
      await ready;
      return memory.get(key) ?? saved.get(key);
    },
    set(key, value) {
      memory.set(key, value);
      if (!storage || wireSize([[key, value]]) > CACHE_BYTES) return;
      writes = writes.then(async () => {
        saved.delete(key);
        saved.set(key, value);
        while (wireSize([...saved]) > CACHE_BYTES) saved.delete(saved.keys().next().value!);
        try {
          await storage.set({ key: KEY, value: [...saved] });
        } catch {
          // Keep the completed step available in memory.
        }
      });
      return writes;
    },
  };
}
