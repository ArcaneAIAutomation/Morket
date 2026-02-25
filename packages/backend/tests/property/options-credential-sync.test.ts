// Feature: menu-fixes-options-config, Property 9: Enrichment provider credential sync
import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';

// Mock dependencies before importing the service
vi.mock('../../src/modules/workspace/options.repository', () => ({
  upsert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/modules/credential/credential.service', () => ({
  store: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/shared/encryption', () => ({
  deriveWorkspaceKey: vi.fn().mockReturnValue(Buffer.alloc(32)),
  encrypt: vi.fn().mockReturnValue({ ciphertext: 'enc', iv: 'iv', authTag: 'tag' }),
  decrypt: vi.fn(),
}));

vi.mock('../../src/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { upsertConfiguration } from '../../src/modules/workspace/options.service';
import * as credentialService from '../../src/modules/credential/credential.service';
import * as optionsRepo from '../../src/modules/workspace/options.repository';
import { logger } from '../../src/observability/logger';

const NUM_RUNS = 100;

describe('Feature: menu-fixes-options-config, Property 9: Enrichment provider credential sync', () => {
  /**
   * Property 9: Enrichment provider credential sync
   * For any enrichment provider service key (apollo, clearbit, hunter) and any API key value,
   * saving the configuration via the options service should call credentialService.store
   * with the correct arguments (workspaceId, serviceKey, apiKey, '', userId, masterKey).
   * **Validates: Requirements 10.6**
   */
  it('upsertConfiguration syncs credential for enrichment provider keys', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom('apollo', 'clearbit', 'hunter') as fc.Arbitrary<string>,
        fc.string({ minLength: 8, maxLength: 128 }),
        fc.uuid(),
        async (workspaceId, serviceKey, apiKey, userId) => {
          // Clear call counts only — keep mock implementations intact
          vi.mocked(credentialService.store).mockClear();
          vi.mocked(optionsRepo.upsert).mockClear();
          vi.mocked(logger.info).mockClear();

          const masterKey = 'a'.repeat(64);

          await upsertConfiguration(workspaceId, serviceKey, 'enrichment', { apiKey }, userId, masterKey);

          // credentialService.store must have been called exactly once
          expect(credentialService.store).toHaveBeenCalledTimes(1);

          // Verify correct arguments
          expect(credentialService.store).toHaveBeenCalledWith(
            workspaceId,
            serviceKey,
            apiKey,
            '',
            userId,
            masterKey,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 9 (inverse): Non-enrichment service keys do NOT trigger credential sync
   * For any non-enrichment service key, credentialService.store should NOT be called.
   * **Validates: Requirements 10.6**
   */
  it('upsertConfiguration does NOT sync credential for non-enrichment service keys', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom('scraper', 'salesforce', 'hubspot', 'stripe',
          'temporal', 'opensearch', 'redis', 'clickhouse') as fc.Arbitrary<string>,
        fc.string({ minLength: 8, maxLength: 128 }),
        fc.uuid(),
        async (workspaceId, serviceKey, apiKey, userId) => {
          // Clear call counts only — keep mock implementations intact
          vi.mocked(credentialService.store).mockClear();
          vi.mocked(optionsRepo.upsert).mockClear();
          vi.mocked(logger.info).mockClear();

          const masterKey = 'a'.repeat(64);

          await upsertConfiguration(workspaceId, serviceKey, 'scraping', { apiKey }, userId, masterKey);

          // credentialService.store must NOT have been called
          expect(credentialService.store).not.toHaveBeenCalled();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
