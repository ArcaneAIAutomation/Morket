import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  timeRangeQuerySchema,
  customTimeRangeSchema,
  resolveTimeRange,
  type TimeRangeQuery,
} from '../../src/modules/analytics/analytics.schemas';

/**
 * Property 1: Time range validation bounds
 *
 * For any time range query parameter, the resolved start and end dates SHALL satisfy:
 * start < end, end - start <= 365 days, and end <= now().
 * Invalid ranges SHALL produce a 400 validation error.
 *
 * **Validates: Requirements 3.5, 3.6, 11.6, 14.1, 14.2**
 */

const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000;

// --- Generators ---

const presetArb = fc.constantFrom('24h', '7d', '30d', '90d');

/** Generate a valid custom time range: start < end, span <= 365 days, end <= now */
const validCustomRangeArb = fc
  .record({
    startOffset: fc.integer({ min: 1, max: 364 }), // days before now
    spanDays: fc.integer({ min: 1, max: 365 }),     // span in days
  })
  .filter(({ startOffset, spanDays }) => startOffset + spanDays <= 365)
  .map(({ startOffset, spanDays }) => {
    const now = Date.now();
    const end = new Date(now - startOffset * 86400000);
    const start = new Date(end.getTime() - spanDays * 86400000);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  });

describe('Feature: olap-analytics-layer, Time Range Validation Properties', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2025-06-01T00:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Property 1a: Preset time ranges always resolve to valid bounds
   * **Validates: Requirements 3.5, 3.6**
   */
  it('Property 1a: preset time ranges always resolve to start < end, span <= 365d, end <= now', () => {
    fc.assert(
      fc.property(presetArb, (preset) => {
        const parsed = timeRangeQuerySchema.parse({ preset });
        const resolved = resolveTimeRange(parsed);

        expect(resolved.start.getTime()).toBeLessThan(resolved.end.getTime());
        expect(resolved.end.getTime() - resolved.start.getTime()).toBeLessThanOrEqual(MAX_RANGE_MS);
        expect(resolved.end.getTime()).toBeLessThanOrEqual(Date.now());
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 1b: Valid custom time ranges resolve correctly
   * **Validates: Requirements 3.5, 11.6**
   */
  it('Property 1b: valid custom time ranges resolve to start < end, span <= 365d, end <= now', () => {
    fc.assert(
      fc.property(validCustomRangeArb, (range) => {
        const parsed = timeRangeQuerySchema.parse(range);
        const resolved = resolveTimeRange(parsed);

        expect(resolved.start.getTime()).toBeLessThan(resolved.end.getTime());
        expect(resolved.end.getTime() - resolved.start.getTime()).toBeLessThanOrEqual(MAX_RANGE_MS);
        expect(resolved.end.getTime()).toBeLessThanOrEqual(Date.now());
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 1c: Custom ranges exceeding 365 days are rejected
   * **Validates: Requirements 11.6, 14.2**
   */
  it('Property 1c: custom ranges exceeding 365 days are rejected by validation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 366, max: 1000 }),
        (spanDays) => {
          const now = Date.now();
          const end = new Date(now - 86400000); // 1 day ago to stay <= now
          const start = new Date(end.getTime() - spanDays * 86400000);

          const result = customTimeRangeSchema.safeParse({
            start: start.toISOString(),
            end: end.toISOString(),
          });

          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 1d: Ranges where start >= end are rejected
   * **Validates: Requirements 14.1, 14.2**
   */
  it('Property 1d: ranges where start >= end are rejected', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2024-01-01'), max: new Date('2025-05-01') }),
        fc.integer({ min: 0, max: 100 }),
        (endDate, offsetDays) => {
          // start = end + offsetDays (so start >= end)
          const start = new Date(endDate.getTime() + offsetDays * 86400000);

          const result = customTimeRangeSchema.safeParse({
            start: start.toISOString(),
            end: endDate.toISOString(),
          });

          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 1e: Ranges with end in the future are rejected
   * **Validates: Requirements 14.1, 14.2**
   */
  it('Property 1e: ranges with end in the future are rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 365 }),
        fc.integer({ min: 1, max: 100 }),
        (spanDays, futureDays) => {
          const now = Date.now();
          const end = new Date(now + futureDays * 86400000); // future
          const start = new Date(end.getTime() - spanDays * 86400000);

          const result = customTimeRangeSchema.safeParse({
            start: start.toISOString(),
            end: end.toISOString(),
          });

          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 1f: Default time range (no input) resolves to valid 30d preset
   * **Validates: Requirements 3.6**
   */
  it('Property 1f: default time range resolves to 30d preset with valid bounds', () => {
    const parsed = timeRangeQuerySchema.parse(undefined);
    const resolved = resolveTimeRange(parsed);

    expect(resolved.start.getTime()).toBeLessThan(resolved.end.getTime());
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(resolved.end.getTime() - resolved.start.getTime()).toBe(thirtyDaysMs);
    expect(resolved.end.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
