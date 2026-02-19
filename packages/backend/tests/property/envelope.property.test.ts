import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import request from 'supertest';
import { createApp } from '../../src/app';
import { _resetRateLimiterState } from '../../src/middleware/rateLimiter';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NUM_RUNS = 100;

const app = createApp({
  corsOrigin: '*',
  jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
  jwtAccessExpiry: '15m',
  jwtRefreshExpiry: '7d',
  encryptionMasterKey: 'a'.repeat(64),
});

// Alphanumeric characters safe for URL path segments
const pathCharArb = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
);
const pathSegmentArb = fc.stringOf(pathCharArb, { minLength: 1, maxLength: 12 });
const pathArb = fc
  .array(pathSegmentArb, { minLength: 1, maxLength: 4 })
  .map((segments) => '/' + segments.join('/'));

const methodArb = fc.constantFrom('get', 'post', 'put', 'patch', 'delete') as fc.Arbitrary<
  'get' | 'post' | 'put' | 'patch' | 'delete'
>;

describe('Feature: core-backend-foundation, Property 26: API response envelope conformance', () => {
  beforeEach(() => {
    _resetRateLimiterState();
  });

  /**
   * Property 26: API response envelope conformance
   * For any request to any endpoint (valid or invalid), the response body should
   * conform to the JSON_Envelope schema { success, data, error } and the response
   * should include an X-Request-Id header containing a valid UUID.
   * **Validates: Requirements 7.1, 7.2**
   */
  it('Property 26: API response envelope conformance — any request returns JSON_Envelope with X-Request-Id UUID', async () => {
    await fc.assert(
      fc.asyncProperty(methodArb, pathArb, async (method, path) => {
        _resetRateLimiterState();

        const res = await request(app)[method](path);

        // 1. Response body conforms to JSON_Envelope
        expect(res.body).toHaveProperty('success');
        expect(typeof res.body.success).toBe('boolean');

        expect(res.body).toHaveProperty('data');
        expect(res.body).toHaveProperty('error');

        if (res.body.success) {
          // On success, error must be null
          expect(res.body.error).toBeNull();
        } else {
          // On failure, data must be null, error must have code + message
          expect(res.body.data).toBeNull();
          expect(res.body.error).not.toBeNull();
          expect(typeof res.body.error.code).toBe('string');
          expect(typeof res.body.error.message).toBe('string');
        }

        // 2. X-Request-Id header is a valid UUID
        const requestId = res.headers['x-request-id'];
        expect(requestId).toBeDefined();
        expect(typeof requestId).toBe('string');
        expect(requestId).toMatch(UUID_REGEX);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
