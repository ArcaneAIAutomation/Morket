import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import request from 'supertest';
import { createApp } from '../../src/app';
import { _resetRateLimiterState } from '../../src/middleware/rateLimiter';

const NUM_RUNS = 100;

const app = createApp({
  corsOrigins: ['*'],
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

const methodArb = fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE');

describe('Feature: core-backend-foundation, Property 27: Structured log output', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetRateLimiterState();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  /**
   * Property 27: Structured log output
   * For any API request, the application should produce a structured JSON log entry
   * containing at minimum the fields: method, path, statusCode, and responseTime.
   * **Validates: Requirements 7.9**
   */
  it('Property 27: Structured log output — any request produces log with method, path, statusCode, responseTime', async () => {
    await fc.assert(
      fc.asyncProperty(methodArb, pathArb, async (method, path) => {
        _resetRateLimiterState();
        stdoutWriteSpy.mockClear();

        const httpMethod = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
        await request(app)[httpMethod](path);

        // Find the request log entry among all stdout writes
        const logLines = stdoutWriteSpy.mock.calls
          .map((call) => String(call[0]).trim())
          .filter((line) => line.length > 0);

        // At least one log line should be a valid JSON request log
        const requestLogs = logLines
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(
            (parsed): parsed is Record<string, unknown> =>
              parsed !== null && typeof parsed === 'object' && 'method' in parsed
          );

        expect(requestLogs.length).toBeGreaterThanOrEqual(1);

        const logEntry = requestLogs[requestLogs.length - 1];

        // Verify required fields exist
        expect(logEntry).toHaveProperty('method');
        expect(logEntry).toHaveProperty('path');
        expect(logEntry).toHaveProperty('statusCode');
        expect(logEntry).toHaveProperty('responseTime');

        // Verify field types
        expect(typeof logEntry.method).toBe('string');
        expect(typeof logEntry.path).toBe('string');
        expect(typeof logEntry.statusCode).toBe('number');
        expect(typeof logEntry.responseTime).toBe('number');

        // Verify field values match the request
        expect(logEntry.method).toBe(method);
        expect(logEntry.path).toBe(path);
        expect(logEntry.statusCode).toBeGreaterThanOrEqual(100);
        expect(logEntry.statusCode).toBeLessThan(600);
        expect(logEntry.responseTime).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
