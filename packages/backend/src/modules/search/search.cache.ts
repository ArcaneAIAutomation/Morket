// --- Interfaces ---

export interface CacheEntry<T> {
  data: T;
  expiresAt: number; // Date.now() + TTL
  insertedAt: number; // for LRU ordering
}

export interface SearchCache {
  get<T>(key: string): T | null;
  set<T>(key: string, data: T, ttlMs?: number): void;
  invalidateWorkspace(workspaceId: string): void;
  clear(): void;
  size(): number;
}

// --- LRU Cache Implementation ---

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 500;

export interface SearchCacheOptions {
  defaultTtlMs?: number;
  maxEntries?: number;
}

/**
 * Creates an in-memory LRU cache with configurable TTL and max entries.
 * Evicts the oldest entry (by insertedAt) when max entries is reached.
 */
export function createSearchCache(
  options: SearchCacheOptions = {},
): SearchCache {
  const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const store = new Map<string, CacheEntry<unknown>>();

  function get<T>(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
      store.delete(key);
      return null;
    }

    // Update access time for LRU — delete and re-insert to move to end of Map iteration order
    store.delete(key);
    entry.insertedAt = Date.now();
    store.set(key, entry);

    return entry.data as T;
  }

  function set<T>(key: string, data: T, ttlMs?: number): void {
    // If key already exists, delete it first so re-insert moves it to end
    if (store.has(key)) {
      store.delete(key);
    }

    // Evict oldest entry if at capacity
    while (store.size >= maxEntries) {
      // Map iteration order is insertion order — first key is the oldest
      const oldestKey = store.keys().next().value;
      if (oldestKey !== undefined) {
        store.delete(oldestKey);
      } else {
        break;
      }
    }

    store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? defaultTtlMs),
      insertedAt: Date.now(),
    });
  }

  function invalidateWorkspace(workspaceId: string): void {
    const prefix = `search:${workspaceId}:`;
    for (const key of [...store.keys()]) {
      if (key.startsWith(prefix)) {
        store.delete(key);
      }
    }
  }

  function clear(): void {
    store.clear();
  }

  function size(): number {
    return store.size;
  }

  return { get, set, invalidateWorkspace, clear, size };
}
