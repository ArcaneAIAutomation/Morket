import crypto from 'crypto';
import { getAdapter, listAdapters } from './integration-registry';
import * as integrationRepo from './integration.repository';
import { encrypt, decrypt, deriveWorkspaceKey } from '../../shared/encryption';
import { env } from '../../config/env';
import { NotFoundError, ValidationError } from '../../shared/errors';
import type { OAuthTokens, FieldMapping, CrmRecord } from './adapters/types';

// --- Helpers ---

function getEncryptionKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_MASTER_KEY, 'hex');
}

function encryptTokens(tokens: OAuthTokens, workspaceId: string) {
  const key = deriveWorkspaceKey(getEncryptionKey(), workspaceId);
  const plaintext = JSON.stringify(tokens);
  const result = encrypt(plaintext, key);
  return { encryptedTokens: result.ciphertext, tokenIv: result.iv, tokenTag: result.authTag };
}

function decryptTokens(record: integrationRepo.IntegrationRecord): OAuthTokens {
  const key = deriveWorkspaceKey(getEncryptionKey(), record.workspaceId);
  const plaintext = decrypt(record.encryptedTokens, record.tokenIv, record.tokenTag, key);
  return JSON.parse(plaintext) as OAuthTokens;
}

function getRedirectUri(slug: string): string {
  return `${env.INTEGRATION_OAUTH_REDIRECT_BASE}/${slug}`;
}

function requireAdapter(slug: string) {
  const adapter = getAdapter(slug);
  if (!adapter) throw new NotFoundError(`Integration "${slug}" is not available`);
  return adapter;
}

// In-memory OAuth state store: state → { workspaceId, slug, successRedirectUrl, expiresAt }
const oauthStateStore = new Map<string, {
  workspaceId: string;
  slug: string;
  successRedirectUrl: string;
  expiresAt: number;
}>();

// Clean expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthStateStore) {
    if (val.expiresAt < now) oauthStateStore.delete(key);
  }
}, 5 * 60 * 1000).unref();

// --- Token refresh helper ---

async function getValidTokens(record: integrationRepo.IntegrationRecord): Promise<OAuthTokens> {
  const tokens = decryptTokens(record);
  // If no expiry or still valid (with 60s buffer), return as-is
  if (!tokens.expiresAt || tokens.expiresAt > Date.now() + 60_000) {
    return tokens;
  }
  // Refresh the token
  const adapter = requireAdapter(record.integrationSlug);
  const refreshed = await adapter.refreshToken(tokens.refreshToken);
  // Persist refreshed tokens
  const encrypted = encryptTokens(refreshed, record.workspaceId);
  await integrationRepo.upsertIntegration(
    record.workspaceId,
    record.integrationSlug,
    encrypted.encryptedTokens,
    encrypted.tokenIv,
    encrypted.tokenTag,
  );
  return refreshed;
}

// --- Public API ---

export function listAvailableIntegrations() {
  return listAdapters().map((a) => ({
    slug: a.slug,
    name: a.name,
    supportedEntities: a.supportedEntities,
    defaultFieldMappings: a.defaultFieldMappings,
  }));
}

export async function listConnected(workspaceId: string) {
  const records = await integrationRepo.listIntegrations(workspaceId);
  return records.map((r) => ({
    id: r.id,
    integrationSlug: r.integrationSlug,
    status: r.status,
    connectedAt: r.connectedAt,
  }));
}

export function startOAuthFlow(workspaceId: string, slug: string, successRedirectUrl: string) {
  const adapter = requireAdapter(slug);
  const state = crypto.randomBytes(32).toString('hex');
  oauthStateStore.set(state, {
    workspaceId,
    slug,
    successRedirectUrl,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min TTL
  });
  const authUrl = adapter.getAuthUrl(state, getRedirectUri(slug));
  return { authUrl };
}

export async function handleOAuthCallback(slug: string, code: string, state: string) {
  const stored = oauthStateStore.get(state);
  if (!stored || stored.slug !== slug || stored.expiresAt < Date.now()) {
    throw new ValidationError('Invalid or expired OAuth state');
  }
  oauthStateStore.delete(state);

  const adapter = requireAdapter(slug);
  const tokens = await adapter.exchangeCode(code, getRedirectUri(slug));
  const encrypted = encryptTokens(tokens, stored.workspaceId);
  await integrationRepo.upsertIntegration(
    stored.workspaceId,
    slug,
    encrypted.encryptedTokens,
    encrypted.tokenIv,
    encrypted.tokenTag,
  );

  // Seed default field mappings if none exist
  const existing = await integrationRepo.getFieldMappings(stored.workspaceId, slug);
  if (existing.length === 0 && adapter.defaultFieldMappings.length > 0) {
    await integrationRepo.replaceFieldMappings(
      stored.workspaceId,
      slug,
      adapter.defaultFieldMappings,
    );
  }

  return { redirectUrl: stored.successRedirectUrl };
}

export async function disconnect(workspaceId: string, slug: string) {
  requireAdapter(slug);
  const record = await integrationRepo.findIntegration(workspaceId, slug);
  if (!record) throw new NotFoundError(`Integration "${slug}" is not connected`);
  await integrationRepo.deleteIntegration(workspaceId, slug);
}

export async function getFieldMappings(workspaceId: string, slug: string) {
  requireAdapter(slug);
  return integrationRepo.getFieldMappings(workspaceId, slug);
}

export async function updateFieldMappings(
  workspaceId: string,
  slug: string,
  mappings: Array<{ morketField: string; crmField: string; direction: string }>,
) {
  requireAdapter(slug);
  const record = await integrationRepo.findIntegration(workspaceId, slug);
  if (!record) throw new NotFoundError(`Integration "${slug}" is not connected`);
  return integrationRepo.replaceFieldMappings(workspaceId, slug, mappings);
}

export async function pushRecords(
  workspaceId: string,
  slug: string,
  entity: string,
  records: CrmRecord[],
) {
  const adapter = requireAdapter(slug);
  const record = await integrationRepo.findIntegration(workspaceId, slug);
  if (!record) throw new NotFoundError(`Integration "${slug}" is not connected`);

  const tokens = await getValidTokens(record);
  const mappings = await integrationRepo.getFieldMappings(workspaceId, slug);
  const fieldMappings: FieldMapping[] = mappings
    .filter((m) => m.direction === 'push' || m.direction === 'both')
    .map((m) => ({ morketField: m.morketField, crmField: m.crmField, direction: m.direction }));

  const syncEntry = await integrationRepo.createSyncEntry(workspaceId, slug, 'push');
  try {
    const result = await adapter.pushRecords(tokens, records, fieldMappings, entity);
    await integrationRepo.completeSyncEntry(
      syncEntry.id,
      result.failed === 0 ? 'completed' : 'partially_completed',
      result.total,
      result.success,
      result.failed,
    );
    return result;
  } catch (err) {
    await integrationRepo.completeSyncEntry(syncEntry.id, 'failed', records.length, 0, records.length);
    throw err;
  }
}

export async function pullRecords(
  workspaceId: string,
  slug: string,
  entity: string,
  limit: number,
) {
  const adapter = requireAdapter(slug);
  const record = await integrationRepo.findIntegration(workspaceId, slug);
  if (!record) throw new NotFoundError(`Integration "${slug}" is not connected`);

  const tokens = await getValidTokens(record);
  const mappings = await integrationRepo.getFieldMappings(workspaceId, slug);
  const fieldMappings: FieldMapping[] = mappings
    .filter((m) => m.direction === 'pull' || m.direction === 'both')
    .map((m) => ({ morketField: m.morketField, crmField: m.crmField, direction: m.direction }));

  const syncEntry = await integrationRepo.createSyncEntry(workspaceId, slug, 'pull');
  try {
    const records = await adapter.pullRecords(tokens, entity, fieldMappings, limit);
    await integrationRepo.completeSyncEntry(syncEntry.id, 'completed', records.length, records.length, 0);
    return records;
  } catch (err) {
    await integrationRepo.completeSyncEntry(syncEntry.id, 'failed', 0, 0, 0);
    throw err;
  }
}

export async function getSyncHistory(workspaceId: string, slug: string, limit: number = 20) {
  requireAdapter(slug);
  return integrationRepo.getSyncHistory(workspaceId, slug, limit);
}
