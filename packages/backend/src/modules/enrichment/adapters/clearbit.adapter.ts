import type { ProviderAdapter, ProviderResult } from './types';

const CLEARBIT_API_URL = 'https://person.clearbit.com/v2/combined/find';
const TIMEOUT_MS = 30_000;

/**
 * Clearbit provider adapter.
 *
 * Makes a GET request to Clearbit's combined/find endpoint with a 30-second
 * timeout. Returns a normalised ProviderResult regardless of outcome.
 */
export const clearbitAdapter: ProviderAdapter = {
  async enrich(credentials, input): Promise<ProviderResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const email = input['email'] as string | undefined;
      if (!email) {
        return {
          success: false,
          data: null,
          isComplete: false,
          error: 'Clearbit adapter requires an "email" field in input',
        };
      }

      const url = `${CLEARBIT_API_URL}?email=${encodeURIComponent(email)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${credentials.key}`,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error');
        return {
          success: false,
          data: null,
          isComplete: false,
          error: `Clearbit API error ${response.status}: ${text}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;

      const person = data['person'] as Record<string, unknown> | undefined;
      const isComplete = person != null && Object.keys(person).length > 0;

      return { success: true, data, isComplete };
    } catch (err: unknown) {
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Clearbit API request timed out after 30s'
          : err instanceof Error
            ? err.message
            : 'Unknown error calling Clearbit API';

      return { success: false, data: null, isComplete: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  },
};
