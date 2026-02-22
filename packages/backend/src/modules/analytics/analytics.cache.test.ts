import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAnalyticsCache,
  createCacheKey,
  stableHash,
  type AnalyticsCache,
} from './analytics.cache';

describe('analytics.cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- stableHash ---

  describe('stableHash', () => {
    it('produces identical hashes for objects with same keys in different order', () => {
      const h1 = stableHash({ a: 1, b: 2, c: 3 });
      const h2 = stableHash({ c: 3, a: 1, b: 2 });
      expect(h1).toBe(h2);
    });

    it('produces different hashes for different values', () => {
      const h1 = stableHash({ a: 1 });
      const h2 = stableHash({ a: 2 });
      expect(h1).not.toBe(h2);
    });

    it('handles nested objects with key order independence', () => {
      const h1 = stableHash({ outer: { b: 2, a: 1 } });
      const h2 = stableHash({ outer: { a: 1, b: 2 } });
      expect(h1).toBe(h2);
    });
  });

  // --- createCacheKey ---

  describe('createCacheKey', () => {
    it('produces key with correct prefix format', () => {
      const key = createCacheKey('ws-123', 'enrichment-summary', { preset: '30d' });
      expect(key).toMatch(/^analytics:ws-123:enrichment-summary:/);
    });

    it('produces same key for same inputs', () => {
      const k1 = createCacheKey('ws-1', 'q', { a: 1 });
      const k2 = createCacheKey('ws-1', 'q', { a: 1 });
      expect(k1).toBe(k2);
    });

    it('produces different keys for different workspaces', () => {
      const k1 = createCacheKey('ws-1', 'q', { a: 1 });
      const k2 = createCacheKey('ws-2', 'q', { a: 1 });
      expect(k1).not.toBe(k2);
    });
  });

  // --- createAnalyticsCache ---

  describe('createAnalyticsCache', () => {
    let cache: AnalyticsCache;

    beforeEach(() => {
      cache = createAnalyticsCache({ defaultTtlMs: 1000, maxEntries: 5 });
    });

    it('returns null for missing keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('stores and retrieves values', () => {
      cache.set('key1', { value: 42 });
      expect(cache.get<{ value: number }>('key1')).toEqual({ value: 42 });
    });

    it('reports correct size', () => {
      expect(cache.size()).toBe(0);
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.size()).toBe(2);
    });

    // --- TTL expiry ---

    it('returns null for expired entries', () => {
      cache.set('ttl-key', 'data', 500);
      expect(cache.get('ttl-key')).toBe('data');

      vi.advanceTimersByTime(501);
      expect(cache.get('ttl-key')).toBeNull();
    });

    it('uses default TTL when none specified', () => {
      cache.set('default-ttl', 'data');
      vi.advanceTimersByTime(999);
      expect(cache.get('default-ttl')).toBe('data');

      vi.advanceTimersByTime(2);
      expect(cache.get('default-ttl')).toBeNull();
    });

    it('removes expired entry from store on get', () => {
      cache.set('exp', 'data', 100);
      vi.advanceTimersByTime(101);
      cache.get('exp');
      expect(cache.size()).toBe(0);
    });

    // --- LRU eviction ---

    it('evicts oldest entry when max entries reached', () => {
      // Fill to capacity (maxEntries = 5)
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4);
      cache.set('e', 5);
      expect(cache.size()).toBe(5);

      // Adding one more should evict 'a' (oldest)
      cache.set('f', 6);
      expect(cache.size()).toBe(5);
      expect(cache.get('a')).toBeNull();
      expect(cache.get('f')).toBe(6);
    });

    it('accessing a key refreshes its LRU position', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4);
      cache.set('e', 5);

      // Access 'a' to refresh it
      cache.get('a');

      // Now 'b' should be the oldest
      cache.set('f', 6);
      expect(cache.get('b')).toBeNull();
      expect(cache.get('a')).toBe(1);
    });

    // --- Workspace invalidation ---

    it('invalidateWorkspace removes all keys for that workspace', () => {
      const k1 = createCacheKey('ws-abc', 'summary', { preset: '30d' });
      const k2 = createCacheKey('ws-abc', 'by-provider', { preset: '7d' });
      const k3 = createCacheKey('ws-other', 'summary', { preset: '30d' });

      cache.set(k1, 'data1');
      cache.set(k2, 'data2');
      cache.set(k3, 'data3');
      expect(cache.size()).toBe(3);

      cache.invalidateWorkspace('ws-abc');
      expect(cache.size()).toBe(1);
      expect(cache.get(k1)).toBeNull();
      expect(cache.get(k2)).toBeNull();
      expect(cache.get(k3)).toBe('data3');
    });

    it('invalidateWorkspace is a no-op for unknown workspace', () => {
      cache.set('analytics:ws-1:q:hash', 'data');
      cache.invalidateWorkspace('ws-unknown');
      expect(cache.size()).toBe(1);
    });

    // --- clear ---

    it('clear removes all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.get('a')).toBeNull();
    });

    // --- Overwrite existing key ---

    it('overwriting a key updates the value and resets TTL', () => {
      cache.set('key', 'old', 1000);
      vi.advanceTimersByTime(500);
      cache.set('key', 'new', 1000);
      vi.advanceTimersByTime(700);
      // Old TTL would have expired, but new TTL should still be valid
      expect(cache.get('key')).toBe('new');
    });
  });
});
