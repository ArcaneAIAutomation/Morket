import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { deriveWorkspaceKey, encrypt, decrypt } from '../../src/shared/encryption';
import { randomBytes } from 'crypto';

const NUM_RUNS = 100;

// Fixed master key for property tests
const MASTER_KEY = randomBytes(32);

describe('Feature: core-backend-foundation, Encryption Properties', () => {
  /**
   * Property 14: Credential encryption round-trip
   * For any plaintext string, encrypt then decrypt should return the original.
   * **Validates: Requirements 5.1**
   */
  it('Property 14: Credential encryption round-trip', () => {
    fc.assert(
      fc.property(fc.string(), (plaintext) => {
        const key = deriveWorkspaceKey(MASTER_KEY, 'test-workspace-id');
        const { ciphertext, iv, authTag } = encrypt(plaintext, key);
        const decrypted = decrypt(ciphertext, iv, authTag, key);
        expect(decrypted).toBe(plaintext);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  /**
   * Property 17: Unique IV per encryption
   * For any two encryptions of the same plaintext, IVs should differ.
   * **Validates: Requirements 5.4**
   */
  it('Property 17: Unique IV per encryption', () => {
    fc.assert(
      fc.property(fc.string(), (plaintext) => {
        const key = deriveWorkspaceKey(MASTER_KEY, 'test-workspace-id');
        const result1 = encrypt(plaintext, key);
        const result2 = encrypt(plaintext, key);
        expect(result1.iv).not.toBe(result2.iv);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  /**
   * Property 18: Per-workspace key derivation distinctness
   * For any two workspace IDs, derived keys should differ.
   * **Validates: Requirements 5.5**
   */
  it('Property 18: Per-workspace key derivation distinctness', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (workspaceId1, workspaceId2) => {
          fc.pre(workspaceId1 !== workspaceId2);
          const key1 = deriveWorkspaceKey(MASTER_KEY, workspaceId1);
          const key2 = deriveWorkspaceKey(MASTER_KEY, workspaceId2);
          expect(key1.equals(key2)).toBe(false);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
