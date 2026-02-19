import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import {
  deriveWorkspaceKey,
  encrypt,
  decrypt,
  EncryptionResult,
} from './encryption';

const TEST_MASTER_KEY = randomBytes(32);

describe('deriveWorkspaceKey', () => {
  it('returns a 32-byte buffer', () => {
    const key = deriveWorkspaceKey(TEST_MASTER_KEY, 'workspace-1');
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it('produces the same key for the same inputs', () => {
    const key1 = deriveWorkspaceKey(TEST_MASTER_KEY, 'workspace-a');
    const key2 = deriveWorkspaceKey(TEST_MASTER_KEY, 'workspace-a');
    expect(key1.equals(key2)).toBe(true);
  });

  it('produces different keys for different workspace IDs', () => {
    const key1 = deriveWorkspaceKey(TEST_MASTER_KEY, 'workspace-a');
    const key2 = deriveWorkspaceKey(TEST_MASTER_KEY, 'workspace-b');
    expect(key1.equals(key2)).toBe(false);
  });

  it('produces different keys for different master keys', () => {
    const otherMaster = randomBytes(32);
    const key1 = deriveWorkspaceKey(TEST_MASTER_KEY, 'workspace-1');
    const key2 = deriveWorkspaceKey(otherMaster, 'workspace-1');
    expect(key1.equals(key2)).toBe(false);
  });
});

describe('encrypt and decrypt round-trip', () => {
  const key = deriveWorkspaceKey(TEST_MASTER_KEY, 'ws-roundtrip');

  it('round-trips a simple string', () => {
    const plaintext = 'my-secret-api-key-12345';
    const result = encrypt(plaintext, key);
    const decrypted = decrypt(result.ciphertext, result.iv, result.authTag, key);
    expect(decrypted).toBe(plaintext);
  });

  it('round-trips an empty string', () => {
    const result = encrypt('', key);
    const decrypted = decrypt(result.ciphertext, result.iv, result.authTag, key);
    expect(decrypted).toBe('');
  });

  it('round-trips unicode content', () => {
    const plaintext = '🔑 clé secrète — 密钥';
    const result = encrypt(plaintext, key);
    const decrypted = decrypt(result.ciphertext, result.iv, result.authTag, key);
    expect(decrypted).toBe(plaintext);
  });
});

describe('encrypt', () => {
  const key = deriveWorkspaceKey(TEST_MASTER_KEY, 'ws-encrypt');

  it('returns base64-encoded ciphertext, iv, and authTag', () => {
    const result = encrypt('test', key);
    expect(() => Buffer.from(result.ciphertext, 'base64')).not.toThrow();
    expect(() => Buffer.from(result.iv, 'base64')).not.toThrow();
    expect(() => Buffer.from(result.authTag, 'base64')).not.toThrow();
  });

  it('generates a 12-byte IV (16 base64 chars)', () => {
    const result = encrypt('test', key);
    const ivBuf = Buffer.from(result.iv, 'base64');
    expect(ivBuf.length).toBe(12);
  });

  it('generates a 16-byte auth tag', () => {
    const result = encrypt('test', key);
    const tagBuf = Buffer.from(result.authTag, 'base64');
    expect(tagBuf.length).toBe(16);
  });

  it('produces different IVs for successive encryptions', () => {
    const r1 = encrypt('same-text', key);
    const r2 = encrypt('same-text', key);
    expect(r1.iv).not.toBe(r2.iv);
  });
});

describe('decrypt', () => {
  const key = deriveWorkspaceKey(TEST_MASTER_KEY, 'ws-decrypt');

  it('throws on tampered ciphertext', () => {
    const result = encrypt('secret', key);
    const tampered = Buffer.from(result.ciphertext, 'base64');
    tampered[0] ^= 0xff;
    expect(() =>
      decrypt(tampered.toString('base64'), result.iv, result.authTag, key)
    ).toThrow();
  });

  it('throws on wrong key', () => {
    const result = encrypt('secret', key);
    const wrongKey = deriveWorkspaceKey(TEST_MASTER_KEY, 'wrong-workspace');
    expect(() =>
      decrypt(result.ciphertext, result.iv, result.authTag, wrongKey)
    ).toThrow();
  });

  it('throws on tampered auth tag', () => {
    const result = encrypt('secret', key);
    const tampered = Buffer.from(result.authTag, 'base64');
    tampered[0] ^= 0xff;
    expect(() =>
      decrypt(result.ciphertext, result.iv, tampered.toString('base64'), key)
    ).toThrow();
  });
});
