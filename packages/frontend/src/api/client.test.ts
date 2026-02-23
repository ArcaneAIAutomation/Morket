import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import {
  apiClient,
  enrichmentClient,
  parseApiError,
  refreshAccessToken,
  connectAuthStore,
  connectUIStore,
} from './client';

// We test the exported helpers and the client configuration directly.
// Interceptor behavior is tested via parseApiError and refreshAccessToken.

describe('api/client', () => {
  describe('timeout configuration', () => {
    it('apiClient has 30s timeout', () => {
      expect(apiClient.defaults.timeout).toBe(30_000);
    });

    it('enrichmentClient has 120s timeout', () => {
      expect(enrichmentClient.defaults.timeout).toBe(120_000);
    });

    it('apiClient uses /api/v1 baseURL', () => {
      expect(apiClient.defaults.baseURL).toBe('/api/v1');
    });

    it('enrichmentClient uses /api/v1 baseURL', () => {
      expect(enrichmentClient.defaults.baseURL).toBe('/api/v1');
    });

    it('apiClient sets Referrer-Policy header', () => {
      expect(apiClient.defaults.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });

    it('enrichmentClient sets Referrer-Policy header', () => {
      expect(enrichmentClient.defaults.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });
  });

  describe('parseApiError', () => {
    it('parses an Axios error with envelope', () => {
      const axiosError = new axios.AxiosError('Request failed', '400', undefined, undefined, {
        status: 400,
        data: { success: false, data: null, error: 'Validation failed', meta: { fieldErrors: { email: 'Invalid email' } } },
        statusText: 'Bad Request',
        headers: {},
        config: {} as never,
      } as never);

      const result = parseApiError(axiosError);
      expect(result.status).toBe(400);
      expect(result.message).toBe('Validation failed');
      expect(result.fieldErrors).toEqual({ email: 'Invalid email' });
    });

    it('parses an Axios error without envelope data', () => {
      const axiosError = new axios.AxiosError('Network Error', 'ERR_NETWORK');

      const result = parseApiError(axiosError);
      expect(result.status).toBe(0);
      expect(result.message).toBe('Network Error');
    });

    it('wraps a non-Axios error', () => {
      const result = parseApiError(new Error('Something broke'));
      expect(result.status).toBe(0);
      expect(result.message).toBe('Something broke');
    });

    it('wraps a string error', () => {
      const result = parseApiError('raw string error');
      expect(result.status).toBe(0);
      expect(result.message).toBe('raw string error');
    });
  });

  describe('connectAuthStore / connectUIStore', () => {
    it('connectAuthStore accepts store functions without throwing', () => {
      expect(() =>
        connectAuthStore({
          getAccessToken: () => 'tok',
          getRefreshToken: () => 'ref',
          setTokens: vi.fn(),
          clearAuth: vi.fn(),
        }),
      ).not.toThrow();
    });

    it('connectUIStore accepts store functions without throwing', () => {
      expect(() =>
        connectUIStore({ addToast: vi.fn() }),
      ).not.toThrow();
    });
  });

  describe('refreshAccessToken', () => {
    let mockSetTokens: ReturnType<typeof vi.fn>;
    let mockClearAuth: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockSetTokens = vi.fn();
      mockClearAuth = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns false when no refresh token is available', async () => {
      connectAuthStore({
        getAccessToken: () => null,
        getRefreshToken: () => null,
        setTokens: mockSetTokens,
        clearAuth: mockClearAuth,
      });

      const result = await refreshAccessToken();
      expect(result).toBe(false);
      expect(mockSetTokens).not.toHaveBeenCalled();
    });

    it('returns true and sets tokens on successful refresh', async () => {
      connectAuthStore({
        getAccessToken: () => 'old-access',
        getRefreshToken: () => 'valid-refresh',
        setTokens: mockSetTokens,
        clearAuth: mockClearAuth,
      });

      vi.spyOn(axios, 'post').mockResolvedValue({
        data: {
          data: { accessToken: 'new-access', refreshToken: 'new-refresh' },
        },
      });

      const result = await refreshAccessToken();
      expect(result).toBe(true);
      expect(mockSetTokens).toHaveBeenCalledWith('new-access', 'new-refresh');
    });

    it('returns false when refresh API call fails', async () => {
      connectAuthStore({
        getAccessToken: () => 'old-access',
        getRefreshToken: () => 'expired-refresh',
        setTokens: mockSetTokens,
        clearAuth: mockClearAuth,
      });

      vi.spyOn(axios, 'post').mockRejectedValue(new Error('Refresh failed'));

      const result = await refreshAccessToken();
      expect(result).toBe(false);
      expect(mockSetTokens).not.toHaveBeenCalled();
    });
  });
});
