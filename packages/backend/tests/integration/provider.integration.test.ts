/**
 * Integration tests for Provider API endpoints.
 *
 * Strategy: mock the provider registry to return known provider data.
 * Provider routes are authenticated but have NO RBAC middleware,
 * so only a valid JWT is needed — no db.query mock for role.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app';
import { _resetRateLimiterState } from '../../src/middleware/rateLimiter';

// ─── Constants ────────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long';
const ENCRYPTION_MASTER_KEY = 'a'.repeat(64);

const APP_CONFIG = {
  corsOrigin: 'http://localhost:5173',
  jwtSecret: JWT_SECRET,
  jwtAccessExpiry: '15m',
  jwtRefreshExpiry: '7d',
  encryptionMasterKey: ENCRYPTION_MASTER_KEY,
};

const USER_ID = '11111111-1111-4111-8111-111111111111';

// ─── Mock: shared/db (needed for module imports) ──────────────────────────────

vi.mock('../../src/shared/db', () => ({
  getPool: vi.fn(() => ({ connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }) })),
  query: vi.fn().mockResolvedValue({ rows: [] }),
  setPool: vi.fn(),
  initPool: vi.fn(),
  closePool: vi.fn(),
}));

// ─── Mock: enrichment service ─────────────────────────────────────────────────

vi.mock('../../src/modules/enrichment/enrichment.service', () => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(),
  cancelJob: vi.fn(),
  getRecord: vi.fn(),
  listRecords: vi.fn(),
  setTemporalClient: vi.fn(),
  getTemporalClient: vi.fn(),
  setRegistry: vi.fn(),
}));

// ─── Mock: webhook service ────────────────────────────────────────────────────

vi.mock('../../src/modules/enrichment/webhook.service', () => ({
  createSubscription: vi.fn(),
  listSubscriptions: vi.fn(),
  deleteSubscription: vi.fn(),
  deliverEvent: vi.fn(),
}));

// ─── Mock: provider registry ──────────────────────────────────────────────────

vi.mock('../../src/modules/enrichment/provider-registry', () => ({
  createProviderRegistry: vi.fn(() => ({
    getAllProviders: vi.fn().mockReturnValue([
      { slug: 'apollo', displayName: 'Apollo', supportedFields: ['email', 'phone'], creditCostPerCall: 2 },
      { slug: 'clearbit', displayName: 'Clearbit', supportedFields: ['email', 'company_info'], creditCostPerCall: 3 },
      { slug: 'hunter', displayName: 'Hunter', supportedFields: ['email'], creditCostPerCall: 1 },
    ]),
    getProvider: vi.fn((slug: string) => {
      const providers: Record<string, unknown> = {
        apollo: { slug: 'apollo', displayName: 'Apollo', supportedFields: ['email', 'phone'], creditCostPerCall: 2 },
        clearbit: { slug: 'clearbit', displayName: 'Clearbit', supportedFields: ['email', 'company_info'], creditCostPerCall: 3 },
        hunter: { slug: 'hunter', displayName: 'Hunter', supportedFields: ['email'], creditCostPerCall: 1 },
      };
      return providers[slug] ?? undefined;
    }),
    getProvidersForField: vi.fn().mockReturnValue([]),
    validateProviders: vi.fn(),
    estimateCredits: vi.fn().mockReturnValue(0),
  })),
  ProviderRegistry: vi.fn(),
}));

// ─── Mock: repository modules (needed for module imports) ─────────────────────

vi.mock('../../src/modules/auth/user.repository', () => ({
  createUser: vi.fn(), findByEmail: vi.fn(), findById: vi.fn(),
}));
vi.mock('../../src/modules/auth/token.repository', () => ({
  createToken: vi.fn(), findByTokenHash: vi.fn(), revokeById: vi.fn(), revokeAllForUser: vi.fn(),
}));
vi.mock('../../src/modules/workspace/workspace.repository', () => ({
  createWorkspace: vi.fn(), findById: vi.fn(), findAllForUser: vi.fn(),
  updateWorkspace: vi.fn(), deleteWorkspace: vi.fn(),
  generateSlug: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-') + '-abc123'),
}));
vi.mock('../../src/modules/workspace/membership.repository', () => ({
  create: vi.fn(), findByUserAndWorkspace: vi.fn(), findAllForWorkspace: vi.fn(),
  updateRole: vi.fn(), deleteMembership: vi.fn(), countOwners: vi.fn(),
}));
vi.mock('../../src/modules/credential/credential.repository', () => ({
  create: vi.fn(), findById: vi.fn(), findAllByWorkspace: vi.fn(),
  deleteCredential: vi.fn(), updateLastUsed: vi.fn(),
}));
vi.mock('../../src/modules/credit/billing.repository', () => ({
  create: vi.fn(), findByWorkspaceId: vi.fn(), updateBalance: vi.fn(), updateAutoRecharge: vi.fn(),
}));
vi.mock('../../src/modules/credit/transaction.repository', () => ({
  create: vi.fn(), findByWorkspaceId: vi.fn(),
}));
vi.mock('../../src/modules/enrichment/job.repository', () => ({
  createJob: vi.fn(), getJobById: vi.fn(), listJobs: vi.fn(), updateJobStatus: vi.fn(),
}));
vi.mock('../../src/modules/enrichment/record.repository', () => ({
  createRecord: vi.fn(), getRecordById: vi.fn(), listRecordsByJob: vi.fn(), getRecordByIdempotencyKey: vi.fn(),
}));
vi.mock('../../src/modules/enrichment/webhook.repository', () => ({
  createSubscription: vi.fn(), listSubscriptions: vi.fn(), getSubscriptionById: vi.fn(),
  deleteSubscription: vi.fn(), getSubscriptionsByEventType: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAccessToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

const app = createApp(APP_CONFIG);
const token = makeAccessToken(USER_ID);

describe('Integration: Provider API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiterState();
  });

  // ─── GET /api/v1/providers ────────────────────────────────────────────────

  describe('GET /api/v1/providers', () => {
    const url = '/api/v1/providers';

    it('should return all registered providers with 200', async () => {
      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].slug).toBe('apollo');
      expect(res.body.data[1].slug).toBe('clearbit');
      expect(res.body.data[2].slug).toBe('hunter');
    });

    it('should return 401 without auth token', async () => {
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /api/v1/providers/:providerSlug ──────────────────────────────────

  describe('GET /api/v1/providers/:providerSlug', () => {
    it('should return provider details with 200', async () => {
      const res = await request(app)
        .get('/api/v1/providers/apollo')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slug).toBe('apollo');
      expect(res.body.data.displayName).toBe('Apollo');
      expect(res.body.data.supportedFields).toEqual(['email', 'phone']);
      expect(res.body.data.creditCostPerCall).toBe(2);
    });

    it('should return 404 for unknown provider slug', async () => {
      const res = await request(app)
        .get('/api/v1/providers/unknown-slug')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 401 without auth token', async () => {
      const res = await request(app).get('/api/v1/providers/apollo');
      expect(res.status).toBe(401);
    });
  });
});
