import type { CrmAdapter, OAuthTokens, CrmRecord, FieldMapping, SyncResult } from './types';
import { env } from '../../../config/env';

const SF_AUTH_URL = 'https://login.salesforce.com/services/oauth2/authorize';
const SF_TOKEN_URL = 'https://login.salesforce.com/services/oauth2/token';
const SF_API_VERSION = 'v59.0';

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

export const salesforceAdapter: CrmAdapter = {
  slug: 'salesforce',
  name: 'Salesforce',
  supportedEntities: ['Contact', 'Lead', 'Account'],
  defaultFieldMappings: [
    { morketField: 'email', crmField: 'Email', direction: 'both' },
    { morketField: 'firstName', crmField: 'FirstName', direction: 'both' },
    { morketField: 'lastName', crmField: 'LastName', direction: 'both' },
    { morketField: 'company', crmField: 'Company', direction: 'both' },
    { morketField: 'title', crmField: 'Title', direction: 'both' },
    { morketField: 'phone', crmField: 'Phone', direction: 'both' },
  ],

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.SALESFORCE_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      state,
      scope: 'api refresh_token',
    });
    return `${SF_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const resp = await fetch(SF_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.SALESFORCE_CLIENT_ID ?? '',
        client_secret: env.SALESFORCE_CLIENT_SECRET ?? '',
        code,
        redirect_uri: redirectUri,
      }),
    });
    const data = await resp.json() as Record<string, unknown>;
    if (!resp.ok) {
      throw new Error(`Salesforce token exchange failed: ${JSON.stringify(data)}`);
    }
    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string,
      instanceUrl: data.instance_url as string,
    };
  },

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const resp = await fetch(SF_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: env.SALESFORCE_CLIENT_ID ?? '',
        client_secret: env.SALESFORCE_CLIENT_SECRET ?? '',
        refresh_token: refreshToken,
      }),
    });
    const data = await resp.json() as Record<string, unknown>;
    if (!resp.ok) {
      throw new Error(`Salesforce token refresh failed: ${JSON.stringify(data)}`);
    }
    return {
      accessToken: data.access_token as string,
      refreshToken,
      instanceUrl: data.instance_url as string,
    };
  },

  async pushRecords(tokens, records, fieldMappings, entity): Promise<SyncResult> {
    const errors: Array<{ index: number; message: string }> = [];
    let success = 0;

    for (let i = 0; i < records.length; i++) {
      try {
        const mapped = mapRecord(records[i], fieldMappings, 'push');
        const url = `${tokens.instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${entity}/`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(mapped),
        });
        if (resp.ok) {
          success++;
        } else {
          const err = await resp.json() as Array<{ message: string }>;
          errors.push({ index: i, message: err[0]?.message ?? 'Unknown error' });
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

    const soql = `SELECT ${crmFields.join(', ')} FROM ${entity} ORDER BY CreatedDate DESC LIMIT ${limit}`;
    const url = `${tokens.instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    if (!resp.ok) {
      throw new Error(`Salesforce query failed: ${resp.status}`);
    }

    const data = await resp.json() as { records: CrmRecord[] };
    return data.records.map((r) => mapRecord(r, fieldMappings, 'pull'));
  },
};
