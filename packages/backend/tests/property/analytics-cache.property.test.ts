import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createCacheKey, stableHash } from '../../src/modules/analytics/analytics.cache';

/**
 * Property 3: Cache key uniqueness
 *
 * For any two analytics queries with different (workspaceId, queryType, timeRange, granularity)
 * tuples, the computed cache keys SHALL be different. For identical tuples, the cache keys
 * SHALL be identical.
 *
 * **Validates: Requirements 11.3, 11.4**
 */

// --- Generators ---

const workspaceIdArb = fc.uuid();

const queryTypeArb = fc.constantFrom(
  'enrichment-summary',
  'enrichment-by-provider',
  'enrichment-by-field',
  'enrichment-over-time',
  'scraping-summary',
  'scraping-by-domain',
  'scraping-by-type',
  'scraping-over-time',
  'credit-summary',
  'credit-by-provider',
  'credit-by-source',
  'credit-over-time',
);

const presetArb = fc.constantFrom('24h', '7d', '30d', '90d');
const granularityArb = fc.constantFrom('hour', 'day', 'week');

const paramsArb = fc.oneof(
  // Preset-based params
  fc.record({
    preset: presetArb,
    granularity: fc.option(granularityArb, { nil: undefined }),
  }),
  // Custom time range params
  fc.record({
    start: fc.date({ min: new Date('2023-01-01'), max: new Date('2025-01-01') }).map((d) => d.toISOString()),
    end: fc.date({ min: new Date('2023-01-01'), max: new Date('2025-01-01') }).map((d) => d.toISOString()),
    granularity: fc.option(granularityArb, { nil: undefined }),
  }),
);

// A full query tuple
const queryTupleArb = fc.record({
  workspaceId: workspaceIdArb,
  queryType: queryTypeArb,
  params: paramsArb,
});

describe('Feature: olap-analytics-layer, Cache Key Uniqueness Properties', () => {
  /**
   * Property 3a: Identical tuples produce identical cache keys
   * **Validates: Requirements 11.3, 11.4**
   */
  it('Property 3a: identical (workspaceId, queryType, params) tuples produce identical cache keys', () => {
    fc.assert(
      fc.property(queryTupleArb, ({ workspaceId, queryType, params }) => {
        const key1 = createCacheKey(workspaceId, queryType, params as Record<string, unknown>);
        const key2 = createCacheKey(workspaceId, queryType, params as Record<string, unknown>);
        expect(key1).toBe(key2);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 3b: Different workspaceIds produce different cache keys
   * **Validates: Requirements 11.4**
   */
  it('Property 3b: different workspaceIds produce different cache keys', () => {
    fc.assert(
      fc.property(
        workspaceIdArb,
        workspaceIdArb,
        queryTypeArb,
        paramsArb,
        (wsId1, wsId2, queryType, params) => {
          fc.pre(wsId1 !== wsId2);
          const key1 = createCacheKey(wsId1, queryType, params as Record<string, unknown>);
          const key2 = createCacheKey(wsId2, queryType, params as Record<string, unknown>);
          expect(key1).not.toBe(key2);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 3c: Different queryTypes produce different cache keys
   * **Validates: Requirements 11.4**
   */
  it('Property 3c: different queryTypes produce different cache keys', () => {
    fc.assert(
      fc.property(
        workspaceIdArb,
        queryTypeArb,
        queryTypeArb,
        paramsArb,
        (wsId, qt1, qt2, params) => {
          fc.pre(qt1 !== qt2);
          const key1 = createCacheKey(wsId, qt1, params as Record<string, unknown>);
          const key2 = createCacheKey(wsId, qt2, params as Record<string, unknown>);
          expect(key1).not.toBe(key2);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 3d: Different params produce different cache keys
   * **Validates: Requirements 11.3**
   */
  it('Property 3d: different params produce different cache keys', () => {
    fc.assert(
      fc.property(
        workspaceIdArb,
        queryTypeArb,
        paramsArb,
        paramsArb,
        (wsId, queryType, params1, params2) => {
          const h1 = stableHash(params1 as Record<string, unknown>);
          const h2 = stableHash(params2 as Record<string, unknown>);
          fc.pre(h1 !== h2); // Only test when params are actually different
          const key1 = createCacheKey(wsId, queryType, params1 as Record<string, unknown>);
          const key2 = createCacheKey(wsId, queryType, params2 as Record<string, unknown>);
          expect(key1).not.toBe(key2);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 3e: stableHash is key-order independent
   * **Validates: Requirements 11.3**
   */
  it('Property 3e: stableHash produces same hash regardless of key insertion order', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.oneof(fc.string(), fc.integer(), fc.boolean()),
          { minKeys: 1, maxKeys: 8 },
        ),
        (obj) => {
          // Reverse the key order
          const keys = Object.keys(obj);
          const reversed: Record<string, unknown> = {};
          for (let i = keys.length - 1; i >= 0; i--) {
            reversed[keys[i]] = obj[keys[i]];
          }
          expect(stableHash(obj)).toBe(stableHash(reversed));
        },
      ),
      { numRuns: 200 },
    );
  });
});
