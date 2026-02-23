import axios, {
  type AxiosInstance,
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { ApiEnvelope, ApiError } from '@/types/api.types';

// ---------------------------------------------------------------------------
// Store accessors — connected when stores initialize (Task 3) to avoid
// circular dependency issues between api/client and stores.
// ---------------------------------------------------------------------------

let getAccessToken: () => string | null = () => null;
let getRefreshToken: () => string | null = () => null;
let setTokens: (access: string, refresh: string) => void = () => {};
let clearAuth: () => void = () => {};
let addToast: (type: string, message: string) => void = () => {};

export function connectAuthStore(fns: {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  setTokens: (access: string, refresh: string) => void;
  clearAuth: () => void;
}) {
  getAccessToken = fns.getAccessToken;
  getRefreshToken = fns.getRefreshToken;
  setTokens = fns.setTokens;
  clearAuth = fns.clearAuth;
}

export function connectUIStore(fns: {
  addToast: (type: string, message: string) => void;
}) {
  addToast = fns.addToast;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extend Axios request config to track retry state. */
interface RetryableConfig extends InternalAxiosRequestConfig {
  _isRetry?: boolean;
}

/** Parse an AxiosError into a structured ApiError. */
export function parseApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const axiosErr = error as AxiosError<ApiEnvelope<unknown>>;
    const status = axiosErr.response?.status ?? 0;
    const envelope = axiosErr.response?.data;
    const message =
      envelope?.error ?? axiosErr.message ?? 'An unexpected error occurred';

    // Backend may return field-level validation errors inside meta
    const fieldErrors =
      (envelope?.meta?.fieldErrors as Record<string, string> | undefined) ??
      undefined;

    return { status, message, fieldErrors };
  }

  // Non-Axios error — wrap it
  return {
    status: 0,
    message: error instanceof Error ? error.message : String(error),
  };
}


/** Flag to prevent concurrent refresh attempts. */
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

/**
 * Attempt to refresh the access token using the stored refresh token.
 * Returns `true` if the refresh succeeded, `false` otherwise.
 */
export async function refreshAccessToken(): Promise<boolean> {
  // Deduplicate concurrent refresh calls
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;

      // Use a plain axios call (no interceptors) to avoid infinite loops
      const response = await axios.post<ApiEnvelope<{ accessToken: string; refreshToken: string }>>(
        '/api/v1/auth/refresh',
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' } },
      );

      const data = response.data?.data;
      if (data?.accessToken && data?.refreshToken) {
        setTokens(data.accessToken, data.refreshToken);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Interceptor setup — shared between apiClient and enrichmentClient
// ---------------------------------------------------------------------------

function attachInterceptors(instance: AxiosInstance): void {
  // ---- Request interceptor: attach Bearer token ----
  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // ---- Response interceptor: unwrap envelope + error handling ----
  instance.interceptors.response.use(
    // Success path — unwrap the envelope and return data directly
    (response) => {
      const envelope = response.data as ApiEnvelope<unknown>;
      // If the response follows the envelope format, unwrap it
      if (envelope && typeof envelope === 'object' && 'success' in envelope) {
        return envelope.data as never;
      }
      // Fallback for non-envelope responses
      return response.data as never;
    },

    // Error path
    async (error: AxiosError<ApiEnvelope<unknown>>) => {
      const config = error.config as RetryableConfig | undefined;
      const status = error.response?.status;

      // 401 — attempt token refresh + retry (once)
      if (status === 401 && config && !config._isRetry) {
        config._isRetry = true;
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          // Retry the original request with the new token
          const token = getAccessToken();
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
          return instance(config);
        }
        // Refresh failed — clear auth and redirect
        clearAuth();
        window.location.href = '/login';
        return Promise.reject(parseApiError(error));
      }

      // 429 — rate limited
      if (status === 429) {
        addToast('warning', 'Rate limited. Please wait before retrying.');
      }

      // 403 — forbidden
      if (status === 403) {
        addToast('error', "You don't have permission for this action");
      }

      // 500 — server error
      if (status === 500) {
        addToast('error', 'A server error occurred. Please try again later.');
      }

      return Promise.reject(parseApiError(error));
    },
  );
}

// ---------------------------------------------------------------------------
// API Client instances
// ---------------------------------------------------------------------------

/** Standard API client — 30s timeout, JSON content type. */
export const apiClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  },
});

attachInterceptors(apiClient);

/** Enrichment client — same config but 120s timeout for long-running jobs. */
export const enrichmentClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  timeout: 120_000,
  headers: {
    'Content-Type': 'application/json',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  },
});

attachInterceptors(enrichmentClient);
