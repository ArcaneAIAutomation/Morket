// Feature: menu-fixes-options-config, Property 6: Configuration encryption round trip
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { randomBytes } from 'crypto';
import { deriveWorkspaceKey, encrypt, decrypt } from '../../src/shared/encryption';

const NUM_RUNS = 100;

describe('Feature: menu-fixes-options-config, Property 6: Configuration encryption round trip', () => {
  /**
   * Property 6: Configuration encryption round trip
   * For any valid Record<string, string> with 1+ entries, encrypting via
   * encrypt(JSON.stringify(values), workspaceKey) and then decrypting via
   * decrypt(ciphertext, iv, authTag, workspaceKey) followed by JSON.parse()
   * should produce an object deeply equal to the original.
   * **Validates: Requirements 8.2**
   */
  it('encrypt → decrypt → JSON.parse produces deeply equal objects', () => {
    const configValuesArb = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ maxLength: 200 }),
      { minKeys: 1, maxKeys: 10 },
    );

    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.uuid(),
        configValuesArb,
        (masterKeyBytes, workspaceId, values) => {
          const masterKey = Buffer.from(masterKeyBytes);
          const workspaceKey = deriveWorkspaceKey(masterKey, workspaceId);

          const plaintext = JSON.stringify(values);
          const { ciphertext, iv, authTag } = encrypt(plaintext, workspaceKey);

          const decrypted = decrypt(ciphertext, iv, authTag, workspaceKey);
          const parsed = JSON.parse(decrypted);

          expect(parsed).toStrictEqual(values);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
