import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';

// Feature: menu-fixes-options-config, Property 5: Options Zod validation rejects invalid configurations

/**
 * Property 5: Options Zod validation rejects invalid configurations
 * **Validates: Requirements 7.4**
 *
 * For any service key and configuration values object that violates the schema
 * constraints (empty values, missing required fields, invalid service keys),
 * the Zod schema should reject the input.
 */

// Replicate the backend Zod schemas locally for frontend validation testing
const serviceKeyEnum = z.enum([
  'apollo', 'clearbit', 'hunter',
  'scraper',
  'salesforce', 'hubspot',
  'stripe',
  'temporal', 'opensearch', 'redis', 'clickhouse',
]);

const upsertOptionsSchema = z.object({
  values: z.record(z.string().min(1), z.string()).refine(
    (obj) => Object.keys(obj).length > 0,
    { message: 'At least one configuration value is required' },
  ),
});

const optionsParamsSchema = z.object({
  id: z.string().uuid(),
  serviceKey: serviceKeyEnum,
});

const VALID_SERVICE_KEYS = [
  'apollo', 'clearbit', 'hunter',
  'scraper',
  'salesforce', 'hubspot',
  'stripe',
  'temporal', 'opensearch', 'redis', 'clickhouse',
] as const;

describe('Property 5: Options Zod validation rejects invalid configurations', () => {
  // --- upsertOptionsSchema: invalid inputs ---

  it('should reject empty values object', () => {
    fc.assert(
      fc.property(fc.constant({}), (emptyObj) => {
        const result = upsertOptionsSchema.safeParse({ values: emptyObj });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('should reject values with empty string keys', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (value) => {
          const result = upsertOptionsSchema.safeParse({ values: { '': value } });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject when values field is missing', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant({}),
          fc.constant({ notValues: 'something' }),
          fc.record({ other: fc.string() }),
        ),
        (input) => {
          const result = upsertOptionsSchema.safeParse(input);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject non-object values for the values field', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.array(fc.string()),
        ),
        (badValues) => {
          const result = upsertOptionsSchema.safeParse({ values: badValues });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- upsertOptionsSchema: valid inputs ---

  it('should accept valid non-empty values with non-empty string keys', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 0, maxLength: 200 }),
          { minKeys: 1, maxKeys: 10 },
        ),
        (values) => {
          const result = upsertOptionsSchema.safeParse({ values });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- optionsParamsSchema: invalid service keys ---

  it('should reject invalid service keys', () => {
    const invalidServiceKeyArb = fc.string({ minLength: 1, maxLength: 50 })
      .filter((s) => !(VALID_SERVICE_KEYS as readonly string[]).includes(s));

    fc.assert(
      fc.property(
        fc.uuid(),
        invalidServiceKeyArb,
        (id, serviceKey) => {
          const result = optionsParamsSchema.safeParse({ id, serviceKey });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject empty string as service key', () => {
    fc.assert(
      fc.property(fc.uuid(), (id) => {
        const result = optionsParamsSchema.safeParse({ id, serviceKey: '' });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // --- optionsParamsSchema: invalid workspace IDs ---

  it('should reject non-UUID workspace IDs', () => {
    const nonUuidArb = fc.string({ minLength: 1, maxLength: 100 })
      .filter((s) => !z.string().uuid().safeParse(s).success);

    fc.assert(
      fc.property(
        nonUuidArb,
        fc.constantFrom(...VALID_SERVICE_KEYS),
        (id, serviceKey) => {
          const result = optionsParamsSchema.safeParse({ id, serviceKey });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject missing fields in optionsParamsSchema', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant({}),
          fc.constant({ id: '550e8400-e29b-41d4-a716-446655440000' }),
          fc.constant({ serviceKey: 'apollo' }),
        ),
        (input) => {
          const result = optionsParamsSchema.safeParse(input);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- optionsParamsSchema: valid inputs ---

  it('should accept valid UUID and valid service key', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.constantFrom(...VALID_SERVICE_KEYS),
        (id, serviceKey) => {
          const result = optionsParamsSchema.safeParse({ id, serviceKey });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- serviceKeyEnum: exhaustive validation ---

  it('should accept all defined valid service keys', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_SERVICE_KEYS),
        (key) => {
          const result = serviceKeyEnum.safeParse(key);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject non-string types as service key', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.array(fc.string()),
          fc.dictionary(fc.string(), fc.string()),
        ),
        (badKey) => {
          const result = serviceKeyEnum.safeParse(badKey);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
