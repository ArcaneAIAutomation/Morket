import { deriveWorkspaceKey, encrypt, decrypt } from '../../shared/encryption';
import { NotFoundError } from '../../shared/errors';
import * as credentialRepository from './credential.repository';
import type { ApiCredential } from './credential.repository';

export type MaskedCredential = Omit<ApiCredential, 'encryptedKey' | 'encryptedSecret' | 'iv' | 'authTag'> & {
  maskedKey: string;
};

function getWorkspaceKey(workspaceId: string, encryptionMasterKey: string): Buffer {
  const masterKey = Buffer.from(encryptionMasterKey, 'hex');
  return deriveWorkspaceKey(masterKey, workspaceId);
}

function maskValue(value: string): string {
  if (value.length <= 4) return value;
  return `****${value.slice(-4)}`;
}

/**
 * Encrypts and stores a new API credential for a workspace.
 * Derives a per-workspace key from the master key + workspaceId,
 * then encrypts both key and secret using AES-256-GCM.
 */
export async function store(
  workspaceId: string,
  providerName: string,
  key: string,
  secret: string,
  createdBy: string,
  encryptionMasterKey: string,
): Promise<ApiCredential> {
  const workspaceKey = getWorkspaceKey(workspaceId, encryptionMasterKey);

  const encryptedKeyResult = encrypt(key, workspaceKey);
  const encryptedSecretResult = encrypt(secret, workspaceKey);

  // Store key's IV and authTag; secret shares the same row but uses its own ciphertext.
  // We store a single IV/authTag pair — one per credential row — so we encrypt key
  // and secret with separate calls but persist the key's IV/authTag in the row.
  // The secret is stored as its own ciphertext alongside the key's IV/authTag.
  // To support independent decryption, we encode the secret's IV+authTag into the
  // encryptedSecret field as: base64(iv):base64(authTag):base64(ciphertext)
  const encryptedSecretBlob = `${encryptedSecretResult.iv}:${encryptedSecretResult.authTag}:${encryptedSecretResult.ciphertext}`;

  return credentialRepository.create({
    workspaceId,
    providerName,
    encryptedKey: encryptedKeyResult.ciphertext,
    encryptedSecret: encryptedSecretBlob,
    iv: encryptedKeyResult.iv,
    authTag: encryptedKeyResult.authTag,
    createdBy,
  });
}

/**
 * Lists all credentials for a workspace with keys masked to last 4 chars.
 * Never returns raw encrypted values.
 */
export async function list(workspaceId: string, encryptionMasterKey: string): Promise<MaskedCredential[]> {
  const credentials = await credentialRepository.findAllByWorkspace(workspaceId);

  return credentials.map(({ encryptedKey, encryptedSecret, iv, authTag, ...rest }) => {
    const workspaceKey = getWorkspaceKey(workspaceId, encryptionMasterKey);
    const rawKey = decrypt(encryptedKey, iv, authTag, workspaceKey);
    return {
      ...rest,
      maskedKey: maskValue(rawKey),
    };
  });
}

/**
 * Permanently removes a credential record.
 */
export async function deleteCredential(credentialId: string): Promise<void> {
  const existing = await credentialRepository.findById(credentialId);
  if (!existing) {
    throw new NotFoundError(`Credential ${credentialId} not found`);
  }
  await credentialRepository.deleteCredential(credentialId);
}

/**
 * Internal only — decrypts and returns the raw key and secret.
 * Used by enrichment services; never exposed via user-facing API endpoints.
 */
export async function decryptCredential(credentialId: string, encryptionMasterKey: string): Promise<{ key: string; secret: string }> {
  const credential = await credentialRepository.findById(credentialId);
  if (!credential) {
    throw new NotFoundError(`Credential ${credentialId} not found`);
  }

  const workspaceKey = getWorkspaceKey(credential.workspaceId, encryptionMasterKey);

  // Decrypt key using stored iv and authTag
  const rawKey = decrypt(credential.encryptedKey, credential.iv, credential.authTag, workspaceKey);

  // Decrypt secret — encoded as iv:authTag:ciphertext
  const parts = credential.encryptedSecret.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format');
  }
  const [secretIv, secretAuthTag, secretCiphertext] = parts;
  const rawSecret = decrypt(secretCiphertext, secretIv, secretAuthTag, workspaceKey);

  await credentialRepository.updateLastUsed(credentialId);

  return { key: rawKey, secret: rawSecret };
}
