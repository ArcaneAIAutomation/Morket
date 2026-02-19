import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

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
 * Uses SHA-256 with the workspace ID as the info parameter.
 */
export function deriveWorkspaceKey(masterKey: Buffer, workspaceId: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.alloc(0), workspaceId, KEY_LENGTH)
  );
}

/**
 * Encrypts plaintext using AES-256-GCM with a random 12-byte IV.
 * Returns base64-encoded ciphertext, IV, and auth tag.
 */
export function encrypt(plaintext: string, key: Buffer): EncryptionResult {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
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
