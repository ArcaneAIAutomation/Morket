import type { ProviderAdapter, ProviderResult } from './types';

const APOLLO_API_URL = 'https://api.apollo.io/v1/people/match';
const TIMEOUT_MS = 30_000;

/**
 * Apollo provider adapter.
 *
 * Makes a POST request to Apollo's people/match endpoint with a 30-second
 * timeout. Returns a normalised ProviderResult regardless of outcome.
 */
export const apolloAdapter: ProviderAdapter = {
  async enrich(credentials, input): Promise<ProviderResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(APOLLO_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': credentials.key,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error');
        return {
          success: false,
          data: null,
          isComplete: false,
          error: `Apollo API error ${response.status}: ${text}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;

      const person = data['person'] as Record<string, unknown> | undefined;
      const isComplete = person != null && Object.keys(person).length > 0;

      return { success: true, data, isComplete };
    } catch (err: unknown) {
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Apollo API request timed out after 30s'
          : err instanceof Error
            ? err.message
            : 'Unknown error calling Apollo API';

      return { success: false, data: null, isComplete: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  },
};
