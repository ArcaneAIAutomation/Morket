// Feature: menu-fixes-options-config, Property 8: Audit log excludes configuration values
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { logger } from '../../src/observability/logger';

const NUM_RUNS = 100;

describe('Feature: menu-fixes-options-config, Property 8: Audit log excludes configuration values', () => {
  /**
   * Property 8: Audit log excludes configuration values
   * For any service configuration upsert with arbitrary config values,
   * the audit log entry should contain userId, workspaceId, and serviceKey,
   * and the serialized log entry string should NOT contain any of the original config values.
   * **Validates: Requirements 8.6**
   */
  it('audit log contains userId, workspaceId, serviceKey but excludes all config values', () => {
    const configValuesArb = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.string({ minLength: 5, maxLength: 200 }),
      { minKeys: 1, maxKeys: 10 },
    );

    fc.assert(
      fc.asyncProperty(
        fc.uuid(),                                          // workspaceId
        fc.constantFrom('apollo', 'clearbit', 'hunter', 'scraper', 'stripe', 'opensearch', 'redis'), // serviceKey
        configValuesArb,                                    // values
        fc.uuid(),                                          // userId
        async (workspaceId, serviceKey, values, userId) => {
          vi.resetAllMocks();

          // Re-setup mocks after reset
          const { encrypt } = await import('../../src/shared/encryption');
          const { deriveWorkspaceKey } = await import('../../src/shared/encryption');
          vi.mocked(deriveWorkspaceKey).mockReturnValue(Buffer.alloc(32));
          vi.mocked(encrypt).mockReturnValue({ ciphertext: 'enc', iv: 'iv', authTag: 'tag' });

          const optionsRepo = await import('../../src/modules/workspace/options.repository');
          vi.mocked(optionsRepo.upsert).mockResolvedValue(undefined);

          const credentialService = await import('../../src/modules/credential/credential.service');
          vi.mocked(credentialService.store).mockResolvedValue(undefined);

          const masterKey = 'a'.repeat(64); // 32-byte hex key

          await upsertConfiguration(workspaceId, serviceKey, 'enrichment', values, userId, masterKey);

          // Verify logger.info was called
          expect(logger.info).toHaveBeenCalled();

          // Get the audit log call arguments
          const calls = vi.mocked(logger.info).mock.calls;
          const auditCall = calls.find(
            (c) => typeof c[0] === 'string' && c[0].includes('audit'),
          );
          expect(auditCall).toBeDefined();

          const [message, meta] = auditCall!;
          const logMeta = meta as Record<string, unknown>;

          // Verify required fields are present
          expect(logMeta.userId).toBe(userId);
          expect(logMeta.workspaceId).toBe(workspaceId);
          expect(logMeta.serviceKey).toBe(serviceKey);

          // Serialize the entire log entry and verify no config values leak
          const serialized = JSON.stringify({ message, ...logMeta });
          for (const configValue of Object.values(values)) {
            expect(serialized).not.toContain(configValue);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
