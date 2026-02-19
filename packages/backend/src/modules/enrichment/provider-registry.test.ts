import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { ValidationError } from '../../shared/errors';
import type { ProviderAdapter } from './adapters/types';
import {
  ProviderRegistry,
  createProviderRegistry,
  type ProviderDefinition,
} from './provider-registry';

/** Minimal mock adapter for test-only provider definitions. */
const mockAdapter: ProviderAdapter = {
  enrich: async () => ({ success: true, data: {}, isComplete: true }),
};

/** Helper to build a minimal ProviderDefinition for tests. */
function makeProvider(overrides: Partial<ProviderDefinition> & { slug: string }): ProviderDefinition {
  return {
    displayName: overrides.slug,
    supportedFields: ['email'],
    creditCostPerCall: 1,
    inputSchema: z.any(),
    outputSchema: z.any(),
    requiredCredentialType: overrides.slug,
    adapter: mockAdapter,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests against the default registry (apollo, clearbit, hunter)
// ---------------------------------------------------------------------------

describe('ProviderRegistry (default providers)', () => {
  const registry = createProviderRegistry();

  // --- getProvider ---

  it('returns the correct provider by slug', () => {
    const apollo = registry.getProvider('apollo');
    expect(apollo).toBeDefined();
    expect(apollo!.slug).toBe('apollo');
    expect(apollo!.displayName).toBe('Apollo');
    expect(apollo!.creditCostPerCall).toBe(2);
  });

  it('returns undefined for an unknown slug', () => {
    expect(registry.getProvider('nonexistent')).toBeUndefined();
  });

  // --- getAllProviders ---

  it('returns all 3 default providers', () => {
    const all = registry.getAllProviders();
    expect(all).toHaveLength(3);
    const slugs = all.map((p) => p.slug).sort();
    expect(slugs).toEqual(['apollo', 'clearbit', 'hunter']);
  });

  // --- getProvidersForField ---

  it('returns all 3 providers for "email"', () => {
    const providers = registry.getProvidersForField('email');
    expect(providers).toHaveLength(3);
    const slugs = providers.map((p) => p.slug).sort();
    expect(slugs).toEqual(['apollo', 'clearbit', 'hunter']);
  });

  it('returns only apollo for "phone"', () => {
    const providers = registry.getProvidersForField('phone');
    expect(providers).toHaveLength(1);
    expect(providers[0].slug).toBe('apollo');
  });

  it('returns only clearbit for "social_profiles"', () => {
    const providers = registry.getProvidersForField('social_profiles');
    expect(providers).toHaveLength(1);
    expect(providers[0].slug).toBe('clearbit');
  });

  it('returns empty array for unsupported field "address"', () => {
    const providers = registry.getProvidersForField('address');
    expect(providers).toHaveLength(0);
  });

  // --- validateProviders ---

  it('succeeds for valid slugs', () => {
    expect(() => registry.validateProviders(['apollo', 'hunter'])).not.toThrow();
  });

  it('throws ValidationError for unknown slugs', () => {
    expect(() => registry.validateProviders(['apollo', 'unknown']))
      .toThrow(ValidationError);
  });

  // --- estimateCredits ---

  it('without waterfall: uses cheapest provider per field', () => {
    // email → cheapest is hunter (cost 1), 10 records → 10
    const estimate = registry.estimateCredits(10, ['email']);
    expect(estimate).toBe(10);
  });

  it('without waterfall: sums across multiple fields', () => {
    // email → hunter cost 1, phone → apollo cost 2, 5 records → 5 + 10 = 15
    const estimate = registry.estimateCredits(5, ['email', 'phone']);
    expect(estimate).toBe(15);
  });

  it('with waterfall: uses first provider cost from waterfall config', () => {
    const estimate = registry.estimateCredits(10, ['email'], {
      email: { providers: ['apollo', 'hunter'] },
    });
    // apollo cost = 2, 10 records → 20
    expect(estimate).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

describe('ProviderRegistry (constructor validation)', () => {
  it('rejects duplicate slugs', () => {
    const defs = [makeProvider({ slug: 'dup' }), makeProvider({ slug: 'dup' })];
    expect(() => new ProviderRegistry(defs)).toThrow(ValidationError);
    expect(() => new ProviderRegistry(defs)).toThrow(/Duplicate provider slug/);
  });

  it('rejects zero credit cost', () => {
    expect(() => new ProviderRegistry([makeProvider({ slug: 'bad', creditCostPerCall: 0 })]))
      .toThrow(ValidationError);
  });

  it('rejects negative credit cost', () => {
    expect(() => new ProviderRegistry([makeProvider({ slug: 'bad', creditCostPerCall: -5 })]))
      .toThrow(ValidationError);
  });

  it('rejects non-integer credit cost', () => {
    expect(() => new ProviderRegistry([makeProvider({ slug: 'bad', creditCostPerCall: 1.5 })]))
      .toThrow(ValidationError);
  });
});
