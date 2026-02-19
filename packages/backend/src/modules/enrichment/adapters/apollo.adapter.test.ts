import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apolloAdapter } from './apollo.adapter';

const credentials = { key: 'test-api-key', secret: '' };
const input = { email: 'jane@example.com' };

describe('apolloAdapter', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns success with data when Apollo responds 200', async () => {
    const body = { person: { first_name: 'Jane', last_name: 'Doe' } };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    });

    const result = await apolloAdapter.enrich(credentials, input);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(body);
    expect(result.isComplete).toBe(true);
    expect(result.error).toBeUndefined();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.apollo.io/v1/people/match',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': 'test-api-key',
        },
        body: JSON.stringify(input),
      }),
    );
  });

  it('returns isComplete false when person is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ person: null }),
    });

    const result = await apolloAdapter.enrich(credentials, input);

    expect(result.success).toBe(true);
    expect(result.isComplete).toBe(false);
  });

  it('returns isComplete false when person is empty object', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ person: {} }),
    });

    const result = await apolloAdapter.enrich(credentials, input);

    expect(result.success).toBe(true);
    expect(result.isComplete).toBe(false);
  });

  it('returns failure on non-2xx response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const result = await apolloAdapter.enrich(credentials, input);

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error).toBe('Apollo API error 401: Unauthorized');
  });

  it('returns failure on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await apolloAdapter.enrich(credentials, input);

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBe('ECONNREFUSED');
  });

  it('returns failure on timeout (AbortError)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError'),
    );

    const result = await apolloAdapter.enrich(credentials, input);

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBe('Apollo API request timed out after 30s');
  });

  it('handles text() failure on error response gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('read failed')),
    });

    const result = await apolloAdapter.enrich(credentials, input);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Apollo API error 500: Unknown error');
  });
});
