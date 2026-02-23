import { hkdfSync, randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';

export interface EncryptionResult {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

/**
 * Derives a per-workspace encryption key from a master key using HKDF.
 * Uses SHA-256 with the workspace ID hash as salt and workspace ID as info parameter.
 * Validates master key is exactly 32 bytes before derivation.
 */
export function deriveWorkspaceKey(masterKey: Buffer, workspaceId: string): Buffer {
  if (masterKey.length !== KEY_LENGTH) {
    throw new Error(
      `Master key must be exactly ${KEY_LENGTH} bytes, got ${masterKey.length}`
    );
  }

  const salt = createHash('sha256').update(workspaceId).digest();

  return Buffer.from(
    hkdfSync('sha256', masterKey, salt, workspaceId, KEY_LENGTH)
  );
}

/**
 * Encrypts plaintext using AES-256-GCM with a random 12-byte IV.
 * Returns base64-encoded ciphertext, IV, and auth tag.
 * Uses write-verify pattern: decrypts after encrypting to verify integrity.
 */
export function encrypt(plaintext: string, key: Buffer): EncryptionResult {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const result: EncryptionResult = {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };

  // Write-verify: decrypt immediately to confirm integrity
  const verified = decrypt(result.ciphertext, result.iv, result.authTag, key);
  if (verified !== plaintext) {
    throw new Error('Encryption write-verify failed: decrypted text does not match original plaintext');
  }

  return result;
}

/**
 * Decrypts AES-256-GCM ciphertext using the provided key, IV, and auth tag.
 * All inputs are base64-encoded strings. Returns the original plaintext.
 */
export function decrypt(ciphertext: string, iv: string, authTag: string, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
