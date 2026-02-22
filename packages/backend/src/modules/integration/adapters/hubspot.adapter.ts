import type { CrmAdapter, OAuthTokens, CrmRecord, FieldMapping, SyncResult } from './types';
import { env } from '../../../config/env';

const HS_AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const HS_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const HS_API_BASE = 'https://api.hubapi.com';

function mapRecord(record: CrmRecord, mappings: FieldMapping[], direction: 'push' | 'pull'): CrmRecord {
  const mapped: CrmRecord = {};
  for (const m of mappings) {
    if (m.direction !== direction && m.direction !== 'both') continue;
    const sourceKey = direction === 'push' ? m.morketField : m.crmField;
    const targetKey = direction === 'push' ? m.crmField : m.morketField;
    if (record[sourceKey] !== undefined) {
      mapped[targetKey] = record[sourceKey];
    }
  }
  return mapped;
}

export const hubspotAdapter: CrmAdapter = {
  slug: 'hubspot',
  name: 'HubSpot',
  supportedEntities: ['contacts', 'companies', 'deals'],
  defaultFieldMappings: [
    { morketField: 'email', crmField: 'email', direction: 'both' },
    { morketField: 'firstName', crmField: 'firstname', direction: 'both' },
    { morketField: 'lastName', crmField: 'lastname', direction: 'both' },
    { morketField: 'company', crmField: 'company', direction: 'both' },
    { morketField: 'title', crmField: 'jobtitle', direction: 'both' },
    { morketField: 'phone', crmField: 'phone', direction: 'both' },
  ],

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: env.HUBSPOT_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      scope: 'crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.objects.deals.read',
      state,
    });
    return `${HS_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const resp = await fetch(HS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.HUBSPOT_CLIENT_ID ?? '',
        client_secret: env.HUBSPOT_CLIENT_SECRET ?? '',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const data = await resp.json() as Record<string, unknown>;
    if (!resp.ok) {
      throw new Error(`HubSpot token exchange failed: ${JSON.stringify(data)}`);
    }
    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string,
      expiresAt: Date.now() + (data.expires_in as number) * 1000,
    };
  },

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const resp = await fetch(HS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: env.HUBSPOT_CLIENT_ID ?? '',
        client_secret: env.HUBSPOT_CLIENT_SECRET ?? '',
        refresh_token: refreshToken,
      }),
    });
    const data = await resp.json() as Record<string, unknown>;
    if (!resp.ok) {
      throw new Error(`HubSpot token refresh failed: ${JSON.stringify(data)}`);
    }
    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string ?? refreshToken,
      expiresAt: Date.now() + (data.expires_in as number) * 1000,
    };
  },

  async pushRecords(tokens, records, fieldMappings, entity): Promise<SyncResult> {
    const errors: Array<{ index: number; message: string }> = [];
    let success = 0;

    for (let i = 0; i < records.length; i++) {
      try {
        const mapped = mapRecord(records[i], fieldMappings, 'push');
        const resp = await fetch(`${HS_API_BASE}/crm/v3/objects/${entity}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ properties: mapped }),
        });
        if (resp.ok) {
          success++;
        } else {
          const err = await resp.json() as { message?: string };
          errors.push({ index: i, message: err.message ?? 'Unknown error' });
        }
      } catch (err) {
        errors.push({ index: i, message: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return { total: records.length, success, failed: errors.length, errors };
  },

  async pullRecords(tokens, entity, fieldMappings, limit): Promise<CrmRecord[]> {
    const crmFields = fieldMappings
      .filter((m) => m.direction === 'pull' || m.direction === 'both')
      .map((m) => m.crmField);

    if (crmFields.length === 0) return [];

    const resp = await fetch(
      `${HS_API_BASE}/crm/v3/objects/${entity}?limit=${limit}&properties=${crmFields.join(',')}`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    );

    if (!resp.ok) {
      throw new Error(`HubSpot query failed: ${resp.status}`);
    }

    const data = await resp.json() as { results: Array<{ properties: CrmRecord }> };
    return data.results.map((r) => mapRecord(r.properties, fieldMappings, 'pull'));
  },
};
