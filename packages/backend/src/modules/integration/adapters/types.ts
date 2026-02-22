export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
  instanceUrl?: string; // Salesforce-specific
}

export interface FieldMapping {
  morketField: string;
  crmField: string;
  direction: 'push' | 'pull' | 'both';
}

export interface CrmRecord {
  [key: string]: string | number | boolean | null;
}

export interface SyncResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ index: number; message: string }>;
}

export interface CrmAdapter {
  slug: string;
  name: string;
  supportedEntities: string[];
  defaultFieldMappings: FieldMapping[];

  /** Generate OAuth2 authorization URL */
  getAuthUrl(state: string, redirectUri: string): string;

  /** Exchange authorization code for tokens */
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;

  /** Refresh an expired access token */
  refreshToken(refreshToken: string): Promise<OAuthTokens>;

  /** Push records to CRM */
  pushRecords(
    tokens: OAuthTokens,
    records: CrmRecord[],
    fieldMappings: FieldMapping[],
    entity: string,
  ): Promise<SyncResult>;

  /** Pull records from CRM */
  pullRecords(
    tokens: OAuthTokens,
    entity: string,
    fieldMappings: FieldMapping[],
    limit: number,
  ): Promise<CrmRecord[]>;
}
