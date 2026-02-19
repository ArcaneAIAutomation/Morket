/**
 * Provider adapter types for the enrichment orchestration module.
 *
 * These types define the contract that all enrichment provider adapters
 * must implement, enabling a pluggable architecture where new providers
 * can be added without modifying existing code.
 */

/** Supported enrichment field types across all providers. */
export type EnrichmentFieldType =
  | 'email'
  | 'phone'
  | 'company_info'
  | 'job_title'
  | 'social_profiles'
  | 'address';

/** Result returned by a provider adapter after an enrichment call. */
export interface ProviderResult {
  /** Whether the provider call succeeded without errors. */
  success: boolean;
  /** Enrichment data returned by the provider, or null on failure. */
  data: Record<string, unknown> | null;
  /** False if the result is partial/empty, triggering waterfall fallback. */
  isComplete: boolean;
  /** Error message when success is false. */
  error?: string;
}

/** Interface that all provider adapters must implement. */
export interface ProviderAdapter {
  /**
   * Call the external provider API to enrich the given input.
   *
   * @param credentials - Decrypted API credentials for the provider.
   * @param input - Input data to enrich (e.g. email, domain, name).
   * @returns The enrichment result with success/failure status and data.
   */
  enrich(
    credentials: { key: string; secret: string },
    input: Record<string, unknown>,
  ): Promise<ProviderResult>;
}
