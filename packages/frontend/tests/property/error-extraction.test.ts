import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractErrorMessage } from '@/stores/search.store';

// Feature: menu-fixes-options-config, Property 1: Error extraction always produces a readable string

/**
 * Property 1: Error extraction always produces a readable string
 * **Validates: Requirements 1.1, 2.3**
 *
 * For any value thrown by the Axios interceptor (ApiError objects with { status, message },
 * Error instances, plain strings, numbers, null, undefined, or arbitrary objects),
 * the error extraction logic should always produce a typeof === 'string' result
 * that is non-empty and does not equal '[object Object]'.
 */
describe('Property 1: Error extraction always produces a readable string', () => {
  // Arbitrary that generates ApiError-shaped objects with { status, message }
  const apiErrorArb = fc.record({
    status: fc.oneof(fc.constant(0), fc.integer({ min: 100, max: 599 })),
    message: fc.oneof(fc.string({ minLength: 0, maxLength: 200 }), fc.constant(undefined)),
    fieldErrors: fc.oneof(fc.constant(undefined), fc.dictionary(fc.string(), fc.string())),
  });

  // Arbitrary that generates standard Error instances
  const errorInstanceArb = fc.string({ minLength: 0, maxLength: 200 }).map((msg) => new Error(msg));

  // Arbitrary that generates arbitrary objects (potential [object Object] traps)
  const arbitraryObjectArb = fc.oneof(
    fc.dictionary(fc.string(), fc.string()),
    fc.dictionary(fc.string(), fc.integer()),
    fc.constant({}),
    fc.constant({ foo: 'bar' }),
    fc.constant({ toString: () => '' }),
  );

  // Combined arbitrary covering all error-like values
  const errorLikeArb = fc.oneof(
    apiErrorArb,
    errorInstanceArb,
    fc.string(),
    fc.integer(),
    fc.float(),
    fc.boolean(),
    fc.constant(null),
    fc.constant(undefined),
    fc.constant(NaN),
    arbitraryObjectArb,
  );

  it('should always return a non-empty string that is not [object Object]', () => {
    fc.assert(
      fc.property(errorLikeArb, (err) => {
        const result = extractErrorMessage(err);

        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).not.toBe('[object Object]');
      }),
      { numRuns: 200 },
    );
  });

  it('should extract message from ApiError-shaped objects (non-0, non-500 status)', () => {
    fc.assert(
      fc.property(
        fc.record({
          status: fc.integer({ min: 100, max: 599 }).filter((s) => s !== 500),
          message: fc.string({ minLength: 1, maxLength: 200 }),
        }),
        (apiError) => {
          const result = extractErrorMessage(apiError);

          expect(typeof result).toBe('string');
          expect(result).toBe(apiError.message);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return descriptive message for 500 errors', () => {
    fc.assert(
      fc.property(
        fc.record({
          status: fc.constant(500),
          message: fc.string({ minLength: 0, maxLength: 200 }),
        }),
        (serverError) => {
          const result = extractErrorMessage(serverError);

          expect(typeof result).toBe('string');
          expect(result).toBe(
            'Search service is unavailable. Please try again later.',
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return connectivity message for network errors (status 0)', () => {
    fc.assert(
      fc.property(
        fc.record({
          status: fc.constant(0),
          message: fc.string({ minLength: 0, maxLength: 200 }),
        }),
        (networkError) => {
          const result = extractErrorMessage(networkError);

          expect(typeof result).toBe('string');
          expect(result).toBe(
            'Unable to connect to the search service. Check your connection and try again.',
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should extract message from Error instances', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (msg) => {
          const result = extractErrorMessage(new Error(msg));

          expect(typeof result).toBe('string');
          expect(result).toBe(msg);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return plain strings as-is', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (str) => {
          const result = extractErrorMessage(str);

          expect(typeof result).toBe('string');
          expect(result).toBe(str);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return fallback for null, undefined, and empty values', () => {
    const emptyLikeArb = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.constant(''),
      fc.constant(0),
      fc.constant(false),
    );

    fc.assert(
      fc.property(emptyLikeArb, (val) => {
        const result = extractErrorMessage(val);

        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).not.toBe('[object Object]');
      }),
      { numRuns: 100 },
    );
  });
});
