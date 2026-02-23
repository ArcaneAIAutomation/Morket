import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sanitizeHtml } from '../../src/utils/sanitize';

// Feature: security-audit, Property 7 (frontend): HTML sanitization encodes dangerous characters
/**
 * Property 7 (frontend): HTML sanitization encodes dangerous characters
 * **Validates: Requirements 9.2, 9.3**
 *
 * For any string with HTML metacharacters, output has all encoded.
 */
describe('Feature: security-audit, Property 7 (frontend): HTML sanitization encodes dangerous characters', () => {
  it('output never contains unescaped <, >, ", \', or & characters from input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const output = sanitizeHtml(input);
        // The output should not contain any raw dangerous characters
        // Check that < > " ' are not present at all
        expect(output).not.toMatch(/</);
        expect(output).not.toMatch(/>/);
        expect(output).not.toMatch(/"/);
        expect(output).not.toMatch(/'/);
        // For &, check it only appears as part of valid entities
        const ampersandMatches = output.match(/&/g) || [];
        const entityMatches = output.match(/&(amp|lt|gt|quot|#x27);/g) || [];
        expect(ampersandMatches.length).toBe(entityMatches.length);
      }),
      { numRuns: 100 },
    );
  });

  it('sanitizeHtml is idempotent for safe strings (no dangerous chars)', () => {
    const safeStringArb = fc.stringOf(
      fc.constantFrom(
        'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
        'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ' ', '.', ',',
      ),
    );

    fc.assert(
      fc.property(safeStringArb, (input) => {
        expect(sanitizeHtml(input)).toBe(input);
      }),
      { numRuns: 100 },
    );
  });

  it('output length is always >= input length (encoding expands characters)', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(sanitizeHtml(input).length).toBeGreaterThanOrEqual(input.length);
      }),
      { numRuns: 100 },
    );
  });
});

import { isValidUUID, isValidSlug, validateRouteParams } from '../../src/utils/validateParams';

// Feature: security-audit, Property 26: Deep link parameter validation
/**
 * Property 26: Deep link parameter validation
 * **Validates: Requirements 9.5**
 *
 * For any route parameter not matching expected pattern (UUID v4 for IDs,
 * alphanumeric-dash for slugs), validator rejects before API call.
 */
describe('Feature: security-audit, Property 26: Deep link parameter validation', () => {
  const uuidV4Arb = fc.tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.constantFrom('8', '9', 'a', 'b'),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.hexaString({ minLength: 12, maxLength: 12 }),
  ).map(([a, b, c, variant, d, e]) => `${a}-${b}-4${c}-${variant}${d}-${e}`);

  it('valid UUID v4 strings are accepted by isValidUUID', () => {
    fc.assert(
      fc.property(uuidV4Arb, (uuid) => {
        expect(isValidUUID(uuid)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('invalid UUID strings are rejected by isValidUUID', () => {
    // Generate strings that are clearly not UUID v4 format
    const invalidUuidArb = fc.oneof(
      // Random short strings
      fc.string({ minLength: 1, maxLength: 10 }),
      // Strings with special characters
      fc.string().filter((s) => s.length > 0 && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)),
    );

    fc.assert(
      fc.property(invalidUuidArb, (value) => {
        expect(isValidUUID(value)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('valid slugs are accepted by isValidSlug', () => {
    // Generate alphanumeric-dash strings that match the slug pattern
    const validSlugArb = fc.tuple(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
      fc.array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'.split('')),
        { minLength: 0, maxLength: 20 },
      ),
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
    ).map(([first, middle, last]) => {
      if (middle.length === 0) return first;
      return first + middle.join('') + last;
    });

    fc.assert(
      fc.property(validSlugArb, (slug) => {
        expect(isValidSlug(slug)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('invalid slugs are rejected by isValidSlug', () => {
    // Generate strings with special characters that should fail slug validation
    const invalidSlugArb = fc.oneof(
      // Strings starting with dash
      fc.string({ minLength: 1, maxLength: 20 }).map((s) => '-' + s),
      // Strings with spaces or special chars
      fc.string({ minLength: 2, maxLength: 20 }).filter((s) =>
        /[^a-zA-Z0-9-]/.test(s) && s.length > 0,
      ),
      // Strings longer than 100 chars (exceeds slug length limit)
      fc.stringOf(fc.constantFrom('a', 'b', 'c'), { minLength: 101, maxLength: 120 }),
    );

    fc.assert(
      fc.property(invalidSlugArb, (value) => {
        expect(isValidSlug(value)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('validateRouteParams rejects any params with invalid workspaceId', () => {
    // Generate non-UUID strings for workspaceId param
    const invalidIdArb = fc.string({ minLength: 1, maxLength: 30 }).filter(
      (s) => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s),
    );

    fc.assert(
      fc.property(invalidIdArb, (badId) => {
        expect(validateRouteParams({ workspaceId: badId })).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
