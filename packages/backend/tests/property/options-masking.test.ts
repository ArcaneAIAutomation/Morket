// Feature: menu-fixes-options-config, Property 7: Sensitive field masking
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { maskValue } from '../../src/modules/workspace/options.service';

const NUM_RUNS = 100;

describe('Feature: menu-fixes-options-config, Property 7: Sensitive field masking', () => {
  /**
   * Property 7: Sensitive field masking
   * For any string of length > 4, maskValue returns a string starting with "****"
   * and ending with the last 4 chars of the original, and the result is not equal
   * to the original. For any string of length ≤ 4, maskValue returns the original.
   * **Validates: Requirements 8.3**
   */
  it('strings longer than 4 chars are masked as ****<last4> and differ from original', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 200 }),
        (value) => {
          const masked = maskValue(value);
          expect(masked).toMatch(/^\*{4}/);
          expect(masked.slice(4)).toBe(value.slice(-4));
          expect(masked).not.toBe(value);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('strings of length ≤ 4 are returned unchanged', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 4 }),
        (value) => {
          const masked = maskValue(value);
          expect(masked).toBe(value);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
