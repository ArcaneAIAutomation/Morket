/**
 * Integration tests for Enrichment API endpoints.
 *
 * Strategy: mock at the SERVICE level (enrichment.service, webhook.service)
 * since the service orchestrates Temporal, credit checks, and repositories.
 * The integration tests verify the HTTP layer: routing, Zod validation,
 * RBAC middleware, and JSON envelope response format.
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
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '77777777-7777-4777-8777-777777777777';
const RECORD_ID = '88888888-8888-4888-8888-888888888888';

// ─── Mock: shared/db (needed for RBAC middleware) ─────────────────────────────

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
    ]),
    getProvider: vi.fn((slug: string) => {
      const providers: Record<string, unknown> = {
        apollo: { slug: 'apollo', displayName: 'Apollo', supportedFields: ['email', 'phone'], creditCostPerCall: 2 },
        clearbit: { slug: 'clearbit', displayName: 'Clearbit', supportedFields: ['email', 'company_info'], creditCostPerCall: 3 },
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

// ─── Import mocks after vi.mock declarations ──────────────────────────────────

import * as db from '../../src/shared/db';
import * as enrichmentService from '../../src/modules/enrichment/enrichment.service';
import { InsufficientCreditsError, NotFoundError } from '../../src/shared/errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAccessToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

/** Mock RBAC: db.query returns a role row for the workspace membership check */
function mockRbacRole(role: string): void {
  vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role }] } as never);
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const mockJob = {
  id: JOB_ID,
  workspaceId: WORKSPACE_ID,
  status: 'pending',
  requestedFields: ['email'],
  waterfallConfig: null,
  totalRecords: 2,
  completedRecords: 0,
  failedRecords: 0,
  estimatedCredits: 10,
  createdBy: USER_ID,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  completedAt: null,
};

const mockRecord = {
  id: RECORD_ID,
  jobId: JOB_ID,
  workspaceId: WORKSPACE_ID,
  inputData: { email: 'test@example.com' },
  outputData: { phone: '+1234567890' },
  providerSlug: 'apollo',
  creditsConsumed: 5,
  status: 'success',
  errorReason: null,
  idempotencyKey: `${JOB_ID}:0:email:apollo`,
  creditTransactionId: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// ─── Test suite ───────────────────────────────────────────────────────────────

const app = createApp(APP_CONFIG);
const token = makeAccessToken(USER_ID);

describe('Integration: Enrichment API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiterState();
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never);
  });

  // ─── POST /api/v1/workspaces/:id/enrichment-jobs ──────────────────────────

  describe('POST /api/v1/workspaces/:id/enrichment-jobs', () => {
    const url = `/api/v1/workspaces/${WORKSPACE_ID}/enrichment-jobs`;
    const validBody = {
      records: [{ email: 'test@example.com' }],
      fields: ['email'],
    };

    it('should create a job and return 201 with job ID and estimated credits', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.createJob).mockResolvedValueOnce(mockJob);

      const res = await request(app)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(JOB_ID);
      expect(res.body.data.estimatedCredits).toBe(10);
      expect(enrichmentService.createJob).toHaveBeenCalledWith(
        WORKSPACE_ID,
        USER_ID,
        validBody,
      );
    });

    it('should return 401 without auth token', async () => {
      const res = await request(app).post(url).send(validBody);
      expect(res.status).toBe(401);
    });

    it('should return 400 on invalid body (missing fields)', async () => {
      mockRbacRole('member');

      const res = await request(app)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .send({ records: [{ email: 'test@example.com' }] }); // missing 'fields'

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 on empty records array', async () => {
      mockRbacRole('member');

      const res = await request(app)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .send({ records: [], fields: ['email'] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 402 on insufficient credits', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.createJob).mockRejectedValueOnce(
        new InsufficientCreditsError('Insufficient credits: balance is 0, estimated cost is 10'),
      );

      const res = await request(app)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .send(validBody);

      expect(res.status).toBe(402);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
    });
  });

  // ─── GET /api/v1/workspaces/:id/enrichment-jobs ───────────────────────────

  describe('GET /api/v1/workspaces/:id/enrichment-jobs', () => {
    const url = `/api/v1/workspaces/${WORKSPACE_ID}/enrichment-jobs`;

    it('should return paginated list of jobs', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.listJobs).mockResolvedValueOnce({
        jobs: [mockJob],
        total: 1,
      });

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(JOB_ID);
      expect(res.body.meta).toEqual({ page: 1, limit: 50, total: 1 });
    });

    it('should accept page and limit query params', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.listJobs).mockResolvedValueOnce({
        jobs: [],
        total: 0,
      });

      const res = await request(app)
        .get(`${url}?page=2&limit=10`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(enrichmentService.listJobs).toHaveBeenCalledWith(
        WORKSPACE_ID,
        { page: 2, limit: 10 },
      );
    });
  });

  // ─── GET /api/v1/workspaces/:id/enrichment-jobs/:jobId ──────────────────────

  describe('GET /api/v1/workspaces/:id/enrichment-jobs/:jobId', () => {
    const url = `/api/v1/workspaces/${WORKSPACE_ID}/enrichment-jobs/${JOB_ID}`;

    it('should return job details', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.getJob).mockResolvedValueOnce(mockJob);

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(JOB_ID);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.totalRecords).toBe(2);
    });

    it('should return 404 for non-existent job', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.getJob).mockRejectedValueOnce(
        new NotFoundError(`Enrichment job ${JOB_ID} not found`),
      );

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid jobId format', async () => {
      mockRbacRole('member');

      const res = await request(app)
        .get(`/api/v1/workspaces/${WORKSPACE_ID}/enrichment-jobs/not-a-uuid`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/v1/workspaces/:id/enrichment-jobs/:jobId/cancel ─────────────

  describe('POST /api/v1/workspaces/:id/enrichment-jobs/:jobId/cancel', () => {
    const url = `/api/v1/workspaces/${WORKSPACE_ID}/enrichment-jobs/${JOB_ID}/cancel`;

    it('should cancel job and return updated job', async () => {
      mockRbacRole('member');
      const cancelledJob = { ...mockJob, status: 'cancelled' };
      vi.mocked(enrichmentService.cancelJob).mockResolvedValueOnce(cancelledJob);

      const res = await request(app)
        .post(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('cancelled');
      expect(enrichmentService.cancelJob).toHaveBeenCalledWith(WORKSPACE_ID, JOB_ID);
    });

    it('should return 404 when cancelling non-existent job', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.cancelJob).mockRejectedValueOnce(
        new NotFoundError(`Enrichment job ${JOB_ID} not found`),
      );

      const res = await request(app)
        .post(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /api/v1/workspaces/:id/enrichment-jobs/:jobId/records ─────────────

  describe('GET /api/v1/workspaces/:id/enrichment-jobs/:jobId/records', () => {
    const url = `/api/v1/workspaces/${WORKSPACE_ID}/enrichment-jobs/${JOB_ID}/records`;

    it('should return paginated records for a job', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.listRecords).mockResolvedValueOnce({
        records: [mockRecord],
        total: 1,
      });

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(RECORD_ID);
      expect(res.body.meta).toEqual({ page: 1, limit: 50, total: 1 });
    });

    it('should pass pagination params to service', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.listRecords).mockResolvedValueOnce({
        records: [],
        total: 0,
      });

      await request(app)
        .get(`${url}?page=3&limit=25`)
        .set('Authorization', `Bearer ${token}`);

      expect(enrichmentService.listRecords).toHaveBeenCalledWith(
        WORKSPACE_ID,
        JOB_ID,
        { page: 3, limit: 25 },
      );
    });
  });

  // ─── GET /api/v1/workspaces/:id/enrichment-records/:recordId ───────────────

  describe('GET /api/v1/workspaces/:id/enrichment-records/:recordId', () => {
    const url = `/api/v1/workspaces/${WORKSPACE_ID}/enrichment-records/${RECORD_ID}`;

    it('should return a single enrichment record', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.getRecord).mockResolvedValueOnce(mockRecord);

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(RECORD_ID);
      expect(res.body.data.providerSlug).toBe('apollo');
      expect(res.body.data.status).toBe('success');
    });

    it('should return 404 for non-existent record', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.getRecord).mockRejectedValueOnce(
        new NotFoundError(`Enrichment record ${RECORD_ID} not found`),
      );

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 for invalid recordId format', async () => {
      mockRbacRole('member');

      const res = await request(app)
        .get(`/api/v1/workspaces/${WORKSPACE_ID}/enrichment-records/bad-id`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  // ─── Validation errors ─────────────────────────────────────────────────────

  describe('Validation errors', () => {
    it('should return 400 when fields contains invalid enum value', async () => {
      mockRbacRole('member');

      const res = await request(app)
        .post(`/api/v1/workspaces/${WORKSPACE_ID}/enrichment-jobs`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          records: [{ email: 'test@example.com' }],
          fields: ['invalid_field'],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 when workspace ID is not a valid UUID', async () => {
      const res = await request(app)
        .get('/api/v1/workspaces/not-a-uuid/enrichment-jobs')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  // ─── Insufficient credits ──────────────────────────────────────────────────

  describe('Insufficient credits', () => {
    it('should return 402 with INSUFFICIENT_CREDITS code when balance is too low', async () => {
      mockRbacRole('member');
      vi.mocked(enrichmentService.createJob).mockRejectedValueOnce(
        new InsufficientCreditsError('Insufficient credits: balance is 5, estimated cost is 100'),
      );

      const res = await request(app)
        .post(`/api/v1/workspaces/${WORKSPACE_ID}/enrichment-jobs`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          records: [{ email: 'test@example.com' }],
          fields: ['email'],
        });

      expect(res.status).toBe(402);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
      expect(res.body.error.message).toContain('Insufficient credits');
    });
  });
});
