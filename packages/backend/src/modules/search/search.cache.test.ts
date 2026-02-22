import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSearchCache, type SearchCache } from './search.cache';

describe('search.cache', () => {
  let cache: SearchCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = createSearchCache({ defaultTtlMs: 1000, maxEntries: 3 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- get / set basics ---

  it('get returns null for missing key', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('set and get round-trip', () => {
    cache.set('key1', { name: 'Alice' });
    expect(cache.get<{ name: string }>('key1')).toEqual({ name: 'Alice' });
  });

  it('set overwrites existing key', () => {
    cache.set('key', 'old');
    cache.set('key', 'new');
    expect(cache.get('key')).toBe('new');
  });

  // --- TTL expiry ---

  it('get returns null for expired entries', () => {
    cache.set('ttl-key', 'data', 500);
    expect(cache.get('ttl-key')).toBe('data');

    vi.advanceTimersByTime(500);
    expect(cache.get('ttl-key')).toBeNull();
  });

  it('get returns value within TTL', () => {
    cache.set('ttl-key', 'data', 500);
    vi.advanceTimersByTime(499);
    expect(cache.get('ttl-key')).toBe('data');
  });

  it('custom TTL overrides default', () => {
    cache.set('short', 'data', 200);
    cache.set('default', 'data');

    vi.advanceTimersByTime(200);
    expect(cache.get('short')).toBeNull();
    expect(cache.get('default')).toBe('data');

    vi.advanceTimersByTime(800);
    expect(cache.get('default')).toBeNull();
  });

  // --- LRU eviction ---

  it('LRU eviction removes oldest entry when at capacity', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.size()).toBe(3);

    cache.set('d', 4);
    expect(cache.size()).toBe(3);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('get updates LRU order', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' to move it to end of LRU
    cache.get('a');

    // Adding 'd' should evict 'b' (now the oldest), not 'a'
    cache.set('d', 4);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  // --- invalidateWorkspace ---

  it('invalidateWorkspace clears all matching keys', () => {
    const wsA = 'aaaa-aaaa';
    const wsB = 'bbbb-bbbb';

    cache = createSearchCache({ defaultTtlMs: 5000, maxEntries: 10 });

    cache.set(`search:${wsA}:suggest:ja`, ['Jane']);
    cache.set(`search:${wsA}:suggest:jo`, ['John']);
    cache.set(`search:${wsB}:suggest:ja`, ['Jack']);

    expect(cache.size()).toBe(3);

    cache.invalidateWorkspace(wsA);

    expect(cache.size()).toBe(1);
    expect(cache.get(`search:${wsA}:suggest:ja`)).toBeNull();
    expect(cache.get(`search:${wsA}:suggest:jo`)).toBeNull();
    expect(cache.get(`search:${wsB}:suggest:ja`)).toEqual(['Jack']);
  });

  // --- clear ---

  it('clear removes all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('a')).toBeNull();
  });

  // --- size ---

  it('size returns correct count', () => {
    expect(cache.size()).toBe(0);
    cache.set('a', 1);
    expect(cache.size()).toBe(1);
    cache.set('b', 2);
    expect(cache.size()).toBe(2);
    cache.set('c', 3);
    expect(cache.size()).toBe(3);
  });
});
