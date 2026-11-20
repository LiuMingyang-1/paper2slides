export interface EmbeddingCache {
  get(key: string): Promise<number[][] | undefined>;
  has(key: string): Promise<boolean>;
  set(key: string, value: number[][]): Promise<void>;
}

const STORE = "vectors";

// A single 1536-dimensional paper index can exceed Anna's entire runtime_state.
// Keep the index on this browser and fall back to memory if iframe storage is denied.
export function createEmbeddingCache(factory?: IDBFactory): EmbeddingCache {
  const memory = new Map<string, number[][]>();
  let database: Promise<IDBDatabase | undefined> | undefined;
  function open() {
    return database ??= new Promise<IDBDatabase | undefined>((resolve) => {
      const request = (factory ?? globalThis.indexedDB)?.open("paper2slides-embeddings-v1", 1);
      if (!request) { resolve(undefined); return; }
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = request.onblocked = () => resolve(undefined);
    }).catch(() => undefined);
  }

  async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await open();
    if (!db) return undefined;
    return new Promise<T | undefined>((resolve) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => resolve(undefined);
    }).catch(() => undefined);
  }

  return {
    async get(key) {
      return memory.get(key) ?? await run<number[][]>("readonly", (store) => store.get(key));
    },
    async has(key) {
      return memory.has(key) || (await run("readonly", (store) => store.count(key)) ?? 0) > 0;
    },
    async set(key, value) {
      memory.set(key, value);
      await run("readwrite", (store) => store.put(value, key));
    },
  };
}
