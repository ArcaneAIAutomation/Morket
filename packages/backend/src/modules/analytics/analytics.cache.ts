import { createHash } from 'crypto';

// --- Interfaces ---

export interface CacheEntry<T> {
  data: T;
  expiresAt: number; // Date.now() + TTL
  insertedAt: number; // for LRU ordering
}

export interface AnalyticsCache {
  get<T>(key: string): T | null;
  set<T>(key: string, data: T, ttlMs?: number): void;
  invalidateWorkspace(workspaceId: string): void;
  clear(): void;
  size(): number;
}

// --- Stable Hash ---

/**
 * Produces a consistent SHA-256 hex hash for an object regardless of key order.
 * Recursively sorts object keys so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash identically.
 */
export function stableHash(params: Record<string, unknown>): string {
  const normalized = stableStringify(params);
  return createHash('sha256').update(normalized).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]));
    return '{' + parts.join(',') + '}';
  }
  return String(value);
}

// --- Cache Key Builder ---

/**
 * Builds a deterministic cache key from workspace, query type, and params.
 */
export function createCacheKey(
  workspaceId: string,
  queryType: string,
  params: Record<string, unknown>,
): string {
  return `analytics:${workspaceId}:${queryType}:${stableHash(params)}`;
}

// --- LRU Cache Implementation ---

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 1000;

export interface AnalyticsCacheOptions {
  defaultTtlMs?: number;
  maxEntries?: number;
}

/**
 * Creates an in-memory LRU cache with configurable TTL and max entries.
 * Evicts the oldest entry (by insertedAt) when max entries is reached.
 */
export function createAnalyticsCache(
  options: AnalyticsCacheOptions = {},
): AnalyticsCache {
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
    const prefix = `analytics:${workspaceId}:`;
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
