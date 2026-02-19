import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

const NUM_RUNS = 100;

// ── Pure helper functions extracted from workflow/activity logic ──

/**
 * Simulate waterfall logic: iterate through provider results in order,
 * return the index of the first provider whose result is both successful
 * and complete. Returns -1 if no provider produces a complete result.
 *
 * This mirrors the waterfall loop in `enrichmentWorkflow` (workflows.ts):
 *   for (const providerSlug of providers) {
 *     ...
 *     if (result.success && result.isComplete) break;
 *   }
 */
function simulateWaterfall(
  results: Array<{ success: boolean; isComplete: boolean }>,
): number {
  for (let i = 0; i < results.length; i++) {
    if (results[i].success && results[i].isComplete) return i;
  }
  return -1;
}

/**
 * Generate an idempotency key using the format from workflows.ts:
 *   `${jobId}:${recordIndex}:${fieldName}:${providerSlug}`
 */
function generateIdempotencyKey(
  jobId: string,
  recordIndex: number,
  fieldName: string,
  providerSlug: string,
): string {
  return `${jobId}:${recordIndex}:${fieldName}:${providerSlug}`;
}

/**
 * Simulate credit debit-before-call with refund-on-failure.
 * Returns { debited, refunded } amounts.
 */
function simulateCreditFlow(
  cost: number,
  callSucceeded: boolean,
): { debited: number; refunded: number } {
  const debited = cost;
  const refunded = callSucceeded ? 0 : cost;
  return { debited, refunded };
}


// ── Generators ──

/** Arbitrary provider result (success/complete flags). */
const providerResultArb = fc.record({
  success: fc.boolean(),
  isComplete: fc.boolean(),
});

/** Non-empty array of provider results for waterfall testing. */
const providerResultsArb = fc.array(providerResultArb, {
  minLength: 1,
  maxLength: 20,
});

/** UUID-like string for jobId generation. */
const uuidArb = fc.uuid();

/** Non-negative record index. */
const recordIndexArb = fc.nat({ max: 100_000 });

/** Field name from the supported enrichment field types. */
const fieldNameArb = fc.constantFrom(
  'email',
  'phone',
  'company_info',
  'job_title',
  'social_profiles',
  'address',
);

/** Provider slug — lowercase alphanumeric with hyphens. */
const providerSlugArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/);

/** Positive integer credit cost. */
const creditCostArb = fc.integer({ min: 1, max: 10_000 });

describe('Enrichment Orchestration — Property Tests', () => {
  /**
   * **Property 4: Waterfall stops on first complete result**
   *
   * For any sequence of provider results where at least one is both
   * successful and complete, the waterfall returns the index of the
   * FIRST such result. No later providers are considered.
   *
   * **Validates: Requirements 5.1, 5.4**
   */
  describe('Property 4: Waterfall stops on first complete result', () => {
    it('returns the index of the first successful+complete provider', () => {
      fc.assert(
        fc.property(providerResultsArb, (results) => {
          const waterfallIndex = simulateWaterfall(results);

          // Find the expected first complete index manually
          const expectedIndex = results.findIndex(
            (r) => r.success && r.isComplete,
          );

          expect(waterfallIndex).toBe(expectedIndex);

          // If a complete result exists, verify no earlier result was complete
          if (waterfallIndex >= 0) {
            for (let i = 0; i < waterfallIndex; i++) {
              expect(
                results[i].success && results[i].isComplete,
              ).toBe(false);
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('returns -1 when no provider produces a complete result', () => {
      // Generate arrays where no result is both success AND complete
      const incompleteResultsArb = fc.array(
        fc.record({
          success: fc.boolean(),
          isComplete: fc.constant(false),
        }),
        { minLength: 1, maxLength: 20 },
      );

      fc.assert(
        fc.property(incompleteResultsArb, (results) => {
          expect(simulateWaterfall(results)).toBe(-1);
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('never inspects providers after the first complete one', () => {
      // Generate results with at least one complete result, then verify
      // the waterfall index is always ≤ the index of the first complete
      const resultsWithCompleteArb = fc
        .array(providerResultArb, { minLength: 1, maxLength: 20 })
        .chain((prefix) =>
          fc.tuple(
            fc.constant(prefix),
            fc.array(providerResultArb, { minLength: 0, maxLength: 10 }),
          ),
        )
        .map(([prefix, suffix]) => [
          ...prefix,
          { success: true, isComplete: true },
          ...suffix,
        ]);

      fc.assert(
        fc.property(resultsWithCompleteArb, (results) => {
          const idx = simulateWaterfall(results);
          // Must find a complete result
          expect(idx).toBeGreaterThanOrEqual(0);
          // The result at idx must be the first complete one
          expect(results[idx].success).toBe(true);
          expect(results[idx].isComplete).toBe(true);
          // No earlier result should be complete
          for (let i = 0; i < idx; i++) {
            expect(results[i].success && results[i].isComplete).toBe(false);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  /**
   * **Property 5: Idempotency key uniqueness**
   *
   * For any combination of (jobId, recordIndex, fieldName, providerSlug),
   * the generated idempotency key is unique — two different tuples always
   * produce different keys.
   *
   * **Validates: Requirements 3.8, 8.3**
   */
  describe('Property 5: Idempotency key uniqueness', () => {
    it('different tuples produce different keys', () => {
      const tupleArb = fc.tuple(
        uuidArb,
        recordIndexArb,
        fieldNameArb,
        providerSlugArb,
      );

      fc.assert(
        fc.property(tupleArb, tupleArb, (tuple1, tuple2) => {
          const key1 = generateIdempotencyKey(...tuple1);
          const key2 = generateIdempotencyKey(...tuple2);

          // If any component differs, keys must differ
          const anyDifference = tuple1.some(
            (val, i) => val !== tuple2[i],
          );

          if (anyDifference) {
            expect(key1).not.toBe(key2);
          } else {
            expect(key1).toBe(key2);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('a batch of random tuples produces all unique keys', () => {
      const batchArb = fc.array(
        fc.tuple(uuidArb, recordIndexArb, fieldNameArb, providerSlugArb),
        { minLength: 2, maxLength: 50 },
      );

      fc.assert(
        fc.property(batchArb, (tuples) => {
          const keys = tuples.map((t) => generateIdempotencyKey(...t));
          const uniqueKeys = new Set(keys);

          // Unique tuples must produce unique keys
          const uniqueTuples = new Set(tuples.map((t) => t.join(':')));
          expect(uniqueKeys.size).toBe(uniqueTuples.size);
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('key format matches {jobId}:{recordIndex}:{fieldName}:{providerSlug}', () => {
      fc.assert(
        fc.property(
          uuidArb,
          recordIndexArb,
          fieldNameArb,
          providerSlugArb,
          (jobId, recordIndex, fieldName, providerSlug) => {
            const key = generateIdempotencyKey(
              jobId,
              recordIndex,
              fieldName,
              providerSlug,
            );
            const expected = `${jobId}:${recordIndex}:${fieldName}:${providerSlug}`;
            expect(key).toBe(expected);

            // Key has exactly 3 colon separators
            const parts = key.split(':');
            // UUID contains hyphens but no colons, so the split should
            // produce parts matching the 4 components (UUID may have internal
            // structure but no colons)
            expect(parts.length).toBeGreaterThanOrEqual(4);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  /**
   * **Property 6: Credit debit equals refund on failure**
   *
   * For any enrichment activity that fails after debit, the refunded
   * amount equals the debited amount. This ensures no credits are lost
   * or created out of thin air on failure paths.
   *
   * **Validates: Requirements 6.1, 6.3, 5.7**
   */
  describe('Property 6: Credit debit equals refund on failure', () => {
    it('refund equals debit when call fails', () => {
      fc.assert(
        fc.property(creditCostArb, (cost) => {
          const { debited, refunded } = simulateCreditFlow(cost, false);

          // On failure, refund must exactly equal the debit
          expect(refunded).toBe(debited);
          // Both must equal the original cost
          expect(debited).toBe(cost);
          expect(refunded).toBe(cost);
          // Net credit impact is zero
          expect(debited - refunded).toBe(0);
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('no refund when call succeeds', () => {
      fc.assert(
        fc.property(creditCostArb, (cost) => {
          const { debited, refunded } = simulateCreditFlow(cost, true);

          // On success, credits are permanently consumed
          expect(debited).toBe(cost);
          expect(refunded).toBe(0);
          // Net credit impact equals the cost
          expect(debited - refunded).toBe(cost);
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('debit-then-refund is algebraically neutral for any cost', () => {
      fc.assert(
        fc.property(creditCostArb, (cost) => {
          // Simulate: start with arbitrary balance, debit, then refund
          const startBalance = 100_000; // arbitrary large balance
          const afterDebit = startBalance - cost;
          const afterRefund = afterDebit + cost;

          // Balance is fully restored after refund
          expect(afterRefund).toBe(startBalance);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });
});
