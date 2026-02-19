/**
 * In-memory provider registry for enrichment providers.
 *
 * Maintains a catalog of enrichment providers keyed by slug, with Zod
 * input/output schemas, credit costs, supported fields, and adapter
 * references. Supports provider lookup, field-based filtering, validation,
 * and credit estimation.
 */

import { z } from 'zod';

import { ValidationError } from '../../shared/errors';
import { apolloAdapter } from './adapters/apollo.adapter';
import { clearbitAdapter } from './adapters/clearbit.adapter';
import { hunterAdapter } from './adapters/hunter.adapter';
import type { EnrichmentFieldType, ProviderAdapter } from './adapters/types';

// === Exported interfaces ===

export interface ProviderDefinition {
  slug: string;
  displayName: string;
  supportedFields: EnrichmentFieldType[];
  creditCostPerCall: number;
  inputSchema: z.ZodSchema;
  outputSchema: z.ZodSchema;
  requiredCredentialType: string;
  adapter: ProviderAdapter;
}

export interface WaterfallConfig {
  [field: string]: {
    providers: string[];
  };
}

export interface IProviderRegistry {
  getProvider(slug: string): ProviderDefinition | undefined;
  getAllProviders(): ProviderDefinition[];
  getProvidersForField(field: EnrichmentFieldType): ProviderDefinition[];
  validateProviders(slugs: string[]): void;
  estimateCredits(
    records: number,
    fields: EnrichmentFieldType[],
    waterfallConfig?: WaterfallConfig,
  ): number;
}

// === Provider Registry implementation ===

export class ProviderRegistry implements IProviderRegistry {
  private readonly providers: Map<string, ProviderDefinition>;

  constructor(definitions: ProviderDefinition[]) {
    this.providers = new Map();

    for (const def of definitions) {
      if (this.providers.has(def.slug)) {
        throw new ValidationError(
          `Duplicate provider slug: "${def.slug}"`,
        );
      }
      if (!Number.isInteger(def.creditCostPerCall) || def.creditCostPerCall <= 0) {
        throw new ValidationError(
          `Provider "${def.slug}" must have a positive integer credit cost, got ${def.creditCostPerCall}`,
        );
      }
      this.providers.set(def.slug, def);
    }
  }

  getProvider(slug: string): ProviderDefinition | undefined {
    return this.providers.get(slug);
  }

  getAllProviders(): ProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  getProvidersForField(field: EnrichmentFieldType): ProviderDefinition[] {
    return this.getAllProviders().filter((p) =>
      p.supportedFields.includes(field),
    );
  }

  validateProviders(slugs: string[]): void {
    const unknown = slugs.filter((s) => !this.providers.has(s));
    if (unknown.length > 0) {
      throw new ValidationError(
        `Unknown provider slug(s): ${unknown.join(', ')}`,
      );
    }
  }

  estimateCredits(
    records: number,
    fields: EnrichmentFieldType[],
    waterfallConfig?: WaterfallConfig,
  ): number {
    let total = 0;

    for (const field of fields) {
      let costPerRecord: number;

      if (waterfallConfig?.[field]) {
        // Optimistic estimate: use the first provider's cost
        const firstSlug = waterfallConfig[field].providers[0];
        const provider = this.providers.get(firstSlug);
        if (!provider) {
          throw new ValidationError(
            `Unknown provider slug in waterfall config: "${firstSlug}"`,
          );
        }
        costPerRecord = provider.creditCostPerCall;
      } else {
        // Use the cheapest provider that supports this field
        const supporting = this.getProvidersForField(field);
        if (supporting.length === 0) {
          continue; // no provider supports this field — skip
        }
        costPerRecord = Math.min(
          ...supporting.map((p) => p.creditCostPerCall),
        );
      }

      total += records * costPerRecord;
    }

    return total;
  }
}

// === Default provider definitions ===

const apolloInputSchema = z.object({
  email: z.string().email(),
});

const apolloOutputSchema = z.object({
  person: z.object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    title: z.string().optional(),
    organization: z.object({
      name: z.string().optional(),
    }).optional(),
    phone_numbers: z.array(z.object({ raw_number: z.string() })).optional(),
  }).optional(),
});

const clearbitInputSchema = z.object({
  email: z.string().email(),
});

const clearbitOutputSchema = z.object({
  person: z.object({
    fullName: z.string().optional(),
    title: z.string().optional(),
    linkedin: z.object({ handle: z.string() }).optional(),
    twitter: z.object({ handle: z.string() }).optional(),
  }).optional(),
  company: z.object({
    name: z.string().optional(),
    domain: z.string().optional(),
    industry: z.string().optional(),
  }).optional(),
});

const hunterInputSchema = z.object({
  domain: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});

const hunterOutputSchema = z.object({
  email: z.string().optional(),
  score: z.number().optional(),
});

const DEFAULT_PROVIDERS: ProviderDefinition[] = [
  {
    slug: 'apollo',
    displayName: 'Apollo',
    supportedFields: ['email', 'phone', 'company_info', 'job_title'],
    creditCostPerCall: 2,
    inputSchema: apolloInputSchema,
    outputSchema: apolloOutputSchema,
    requiredCredentialType: 'apollo',
    adapter: apolloAdapter,
  },
  {
    slug: 'clearbit',
    displayName: 'Clearbit',
    supportedFields: ['email', 'company_info', 'social_profiles'],
    creditCostPerCall: 3,
    inputSchema: clearbitInputSchema,
    outputSchema: clearbitOutputSchema,
    requiredCredentialType: 'clearbit',
    adapter: clearbitAdapter,
  },
  {
    slug: 'hunter',
    displayName: 'Hunter',
    supportedFields: ['email'],
    creditCostPerCall: 1,
    inputSchema: hunterInputSchema,
    outputSchema: hunterOutputSchema,
    requiredCredentialType: 'hunter',
    adapter: hunterAdapter,
  },
];

// === Factory function ===

/** Create a ProviderRegistry pre-loaded with the default providers. */
export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry(DEFAULT_PROVIDERS);
}
