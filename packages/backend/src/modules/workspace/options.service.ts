import { deriveWorkspaceKey, encrypt, decrypt } from '../../shared/encryption';
import { NotFoundError } from '../../shared/errors';
import { logger } from '../../observability/logger';
import * as optionsRepo from './options.repository';
import * as credentialService from '../credential/credential.service';

// --- Types ---

export interface MaskedServiceConfiguration {
  serviceKey: string;
  serviceGroup: string;
  maskedValues: Record<string, string>;
  status: string;
  lastTestedAt: Date | null;
  updatedAt: Date;
}

export interface ConnectionTestResult {
  success: boolean;
  responseTimeMs: number;
  error?: string;
}

// --- Constants ---

const SENSITIVE_FIELD_PATTERNS = ['key', 'secret', 'token', 'password'];

const ENRICHMENT_PROVIDER_KEYS = new Set(['apollo', 'clearbit', 'hunter']);

const SERVICE_GROUP_MAP: Record<string, string> = {
  apollo: 'enrichment',
  clearbit: 'enrichment',
  hunter: 'enrichment',
  scraper: 'scraping',
  salesforce: 'crm',
  hubspot: 'crm',
  stripe: 'billing',
  temporal: 'infrastructure',
  opensearch: 'infrastructure',
  redis: 'infrastructure',
  clickhouse: 'infrastructure',
};

// --- Helpers ---

function getWorkspaceKey(masterKey: string, workspaceId: string): Buffer {
  return deriveWorkspaceKey(Buffer.from(masterKey, 'hex'), workspaceId);
}

function isSensitiveField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function maskValue(value: string): string {
  if (value.length <= 4) return value;
  return `****${value.slice(-4)}`;
}

function maskConfigValues(values: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [field, value] of Object.entries(values)) {
    masked[field] = isSensitiveField(field) ? maskValue(value) : value;
  }
  return masked;
}

function decryptConfigValues(
  config: optionsRepo.ServiceConfiguration,
  workspaceKey: Buffer,
): Record<string, string> {
  const plaintext = decrypt(config.encryptedValues, config.iv, config.authTag, workspaceKey);
  return JSON.parse(plaintext) as Record<string, string>;
}

// --- Service Functions ---

/**
 * Lists all service configurations for a workspace.
 * Decrypts stored values and masks sensitive fields before returning.
 */
export async function listConfigurations(
  workspaceId: string,
  masterKey: string,
): Promise<MaskedServiceConfiguration[]> {
  const configs = await optionsRepo.findAllByWorkspace(workspaceId);
  const workspaceKey = getWorkspaceKey(masterKey, workspaceId);

  return configs.map((config) => {
    const values = decryptConfigValues(config, workspaceKey);
    return {
      serviceKey: config.serviceKey,
      serviceGroup: config.serviceGroup,
      maskedValues: maskConfigValues(values),
      status: config.status,
      lastTestedAt: config.lastTestedAt,
      updatedAt: config.updatedAt,
    };
  });
}

/**
 * Creates or updates a service configuration.
 * Encrypts all values using per-workspace AES-256-GCM key.
 * Syncs enrichment provider credentials to the credential store.
 * Logs audit entry without config values.
 */
export async function upsertConfiguration(
  workspaceId: string,
  serviceKey: string,
  serviceGroup: string,
  values: Record<string, string>,
  userId: string,
  masterKey: string,
): Promise<void> {
  const workspaceKey = getWorkspaceKey(masterKey, workspaceId);
  const plaintext = JSON.stringify(values);
  const { ciphertext, iv, authTag } = encrypt(plaintext, workspaceKey);

  await optionsRepo.upsert(workspaceId, serviceKey, {
    serviceGroup,
    encryptedValues: ciphertext,
    iv,
    authTag,
    createdBy: userId,
  });

  // Sync enrichment provider credentials to the credential store
  if (ENRICHMENT_PROVIDER_KEYS.has(serviceKey) && values.apiKey) {
    await credentialService.store(
      workspaceId,
      serviceKey,
      values.apiKey,
      '',
      userId,
      masterKey,
    );
  }

  logger.info('Service configuration audit: config upserted', {
    event_type: 'service_config_upserted',
    userId,
    workspaceId,
    serviceKey,
  });
}

/**
 * Deletes a service configuration by workspace and service key.
 * Logs audit entry without config values.
 */
export async function deleteConfiguration(
  workspaceId: string,
  serviceKey: string,
): Promise<void> {
  const existing = await optionsRepo.findByServiceKey(workspaceId, serviceKey);
  if (!existing) {
    throw new NotFoundError('Service configuration not found');
  }

  await optionsRepo.deleteByServiceKey(workspaceId, serviceKey);

  logger.info('Service configuration audit: config deleted', {
    event_type: 'service_config_deleted',
    workspaceId,
    serviceKey,
  });
}

/**
 * Tests connectivity to a configured service.
 * Decrypts the stored config, performs a lightweight health check,
 * and updates the configuration status based on the result.
 * Always returns 200 with { success, responseTimeMs, error? }.
 */
export async function testConnection(
  workspaceId: string,
  serviceKey: string,
  masterKey: string,
): Promise<ConnectionTestResult> {
  const config = await optionsRepo.findByServiceKey(workspaceId, serviceKey);
  if (!config) {
    throw new NotFoundError('Service configuration not found');
  }

  const workspaceKey = getWorkspaceKey(masterKey, workspaceId);
  const values = decryptConfigValues(config, workspaceKey);

  const start = Date.now();
  let result: ConnectionTestResult;

  try {
    await performHealthCheck(serviceKey, values);
    const responseTimeMs = Date.now() - start;
    result = { success: true, responseTimeMs };
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    const errorMessage = err instanceof Error ? err.message : 'Connection test failed';
    result = { success: false, responseTimeMs, error: errorMessage };
  }

  // Update status in DB
  const status = result.success ? 'configured' : 'error';
  await optionsRepo.updateStatus(workspaceId, serviceKey, status, new Date());

  return result;
}

/**
 * Performs a lightweight health check for a given service type.
 * Uses a 10-second timeout for all connection tests.
 */
async function performHealthCheck(
  serviceKey: string,
  values: Record<string, string>,
): Promise<void> {
  const TIMEOUT_MS = 10_000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    switch (serviceKey) {
      case 'apollo':
        await fetchWithTimeout('https://api.apollo.io/v1/auth/health', {
          headers: { 'x-api-key': values.apiKey || '' },
          signal: controller.signal,
        });
        break;

      case 'clearbit':
        await fetchWithTimeout('https://company.clearbit.com/v2/companies/find?domain=clearbit.com', {
          headers: { Authorization: `Bearer ${values.apiKey || ''}` },
          signal: controller.signal,
        });
        break;

      case 'hunter':
        await fetchWithTimeout(
          `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(values.apiKey || '')}`,
          { signal: controller.signal },
        );
        break;

      case 'stripe':
        await fetchWithTimeout('https://api.stripe.com/v1/balance', {
          headers: { Authorization: `Bearer ${values.secretKey || ''}` },
          signal: controller.signal,
        });
        break;

      case 'scraper': {
        const baseUrl = (values.serviceUrl || '').replace(/\/+$/, '');
        await fetchWithTimeout(`${baseUrl}/health`, {
          headers: { 'x-service-key': values.serviceKey || '' },
          signal: controller.signal,
        });
        break;
      }

      case 'opensearch': {
        const endpoint = (values.endpoint || '').replace(/\/+$/, '');
        await fetchWithTimeout(`${endpoint}/_cluster/health`, {
          signal: controller.signal,
        });
        break;
      }

      case 'redis':
        // Redis connectivity requires a client library; for now, validate URL format
        if (!values.url) throw new Error('Redis URL is not configured');
        break;

      case 'temporal':
        // Temporal connectivity requires gRPC client; for now, validate address
        if (!values.address) throw new Error('Temporal address is not configured');
        break;

      case 'clickhouse': {
        const chUrl = (values.url || '').replace(/\/+$/, '');
        await fetchWithTimeout(`${chUrl}/ping`, {
          signal: controller.signal,
        });
        break;
      }

      case 'salesforce': {
        const instanceUrl = (values.instanceUrl || '').replace(/\/+$/, '');
        if (!instanceUrl) throw new Error('Salesforce instance URL is not configured');
        await fetchWithTimeout(`${instanceUrl}/services/oauth2/userinfo`, {
          headers: { Authorization: `Bearer ${values.accessToken || ''}` },
          signal: controller.signal,
        });
        break;
      }

      case 'hubspot':
        await fetchWithTimeout('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
          headers: { Authorization: `Bearer ${values.accessToken || ''}` },
          signal: controller.signal,
        });
        break;

      default:
        throw new Error(`Unknown service key: ${serviceKey}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Wrapper around fetch that throws on non-2xx responses.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
): Promise<void> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}

/**
 * Resolves the service group for a given service key.
 */
export function resolveServiceGroup(serviceKey: string): string {
  return SERVICE_GROUP_MAP[serviceKey] || 'unknown';
}
