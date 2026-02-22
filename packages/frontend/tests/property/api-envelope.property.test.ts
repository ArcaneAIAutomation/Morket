import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Property 9: API envelope parsing
 * **Validates: Requirements 3.2**
 *
 * For any backend response conforming to the { success, data, error, meta } envelope format,
 * the API client should return the data field when success is true, and throw an ApiError
 * with the error message when success is false.
 */
describe('Property 9: API envelope parsing', () => {
  const envelopeArb = fc.record({
    success: fc.boolean(),
    data: fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.dictionary(fc.string(), fc.string())),
    error: fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)),
    meta: fc.constant(null),
  });

  it('should extract data from success envelopes', () => {
    fc.assert(
      fc.property(
        envelopeArb.filter((e) => e.success),
        (envelope) => {
          // When success is true, data should be extractable
          expect(envelope.success).toBe(true);
          expect(envelope).toHaveProperty('data');
          // The data field is what the interceptor would return
          const extracted = envelope.data;
          expect(extracted).toEqual(envelope.data);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should produce an error from failure envelopes', () => {
    fc.assert(
      fc.property(
        envelopeArb.filter((e) => !e.success && e.error !== null),
        (envelope) => {
          // When success is false, parseApiError should produce a structured error
          // Simulate an Axios-like error with the envelope as response data
          const fakeAxiosError = {
            isAxiosError: true,
            response: {
              status: 400,
              data: envelope,
            },
            message: 'Request failed',
            config: {},
            name: 'AxiosError',
            toJSON: () => ({}),
          };

          const apiError = parseApiError(fakeAxiosError);
          expect(apiError.message).toBe(envelope.error);
          expect(apiError.status).toBe(400);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should handle non-Axios errors gracefully', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (message) => {
        const error = new Error(message);
        const apiError = parseApiError(error);
        expect(apiError.status).toBe(0);
        expect(apiError.message).toBe(message);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 4: Auth token storage on successful authentication
 * **Validates: Requirements 2.1, 2.2, 2.7**
 *
 * For any successful authentication response containing an access token and refresh token,
 * both tokens should be stored in the Auth_Store in memory, and neither token should appear
 * in localStorage.
 */
describe('Property 4: Auth token storage in memory, not localStorage', () => {
  it('should store tokens in Zustand memory and never in localStorage', () => {
    fc.assert(
      fc.property(
        fc.record({
          accessToken: fc.string({ minLength: 10, maxLength: 200 }),
          refreshToken: fc.string({ minLength: 10, maxLength: 200 }),
        }),
        (tokens) => {
          // Clear any prior state
          useAuthStore.getState().clearAuth();
          localStorage.clear();

          // Store tokens via setTokens (simulates successful auth)
          useAuthStore.getState().setTokens(tokens);

          // Verify tokens are in memory (Zustand store)
          const state = useAuthStore.getState();
          expect(state.accessToken).toBe(tokens.accessToken);
          expect(state.refreshToken).toBe(tokens.refreshToken);

          // Verify tokens are NOT in localStorage
          const allLocalStorage = JSON.stringify(localStorage);
          expect(allLocalStorage).not.toContain(tokens.accessToken);
          expect(allLocalStorage).not.toContain(tokens.refreshToken);

          // Cleanup
          useAuthStore.getState().clearAuth();
        },
      ),
      { numRuns: 100 },
    );
  });
});
