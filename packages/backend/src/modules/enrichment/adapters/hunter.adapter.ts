import type { ProviderAdapter, ProviderResult } from './types';

const HUNTER_API_URL = 'https://api.hunter.io/v2/email-finder';
const TIMEOUT_MS = 30_000;

/**
 * Hunter provider adapter.
 *
 * Makes a GET request to Hunter's email-finder endpoint with a 30-second
 * timeout. Returns a normalised ProviderResult regardless of outcome.
 */
export const hunterAdapter: ProviderAdapter = {
  async enrich(credentials, input): Promise<ProviderResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const domain = input['domain'] as string | undefined;
      const firstName = input['first_name'] as string | undefined;
      const lastName = input['last_name'] as string | undefined;

      if (!domain || !firstName || !lastName) {
        return {
          success: false,
          data: null,
          isComplete: false,
          error:
            'Hunter adapter requires "domain", "first_name", and "last_name" fields in input',
        };
      }

      const params = new URLSearchParams({
        domain,
        first_name: firstName,
        last_name: lastName,
        api_key: credentials.key,
      });

      const url = `${HUNTER_API_URL}?${params.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error');
        return {
          success: false,
          data: null,
          isComplete: false,
          error: `Hunter API error ${response.status}: ${text}`,
        };
      }

      const body = (await response.json()) as Record<string, unknown>;
      const data = body['data'] as Record<string, unknown> | undefined;

      const email = data?.['email'] as string | undefined;
      const isComplete = typeof email === 'string' && email.length > 0;

      return { success: true, data: data ?? null, isComplete };
    } catch (err: unknown) {
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Hunter API request timed out after 30s'
          : err instanceof Error
            ? err.message
            : 'Unknown error calling Hunter API';

      return { success: false, data: null, isComplete: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  },
};
