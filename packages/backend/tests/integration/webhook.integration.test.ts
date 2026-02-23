/**
 * Integration tests for Webhook API endpoints.
 *
 * Strategy: mock at the SERVICE level (webhook.service)
 * since the service orchestrates repository calls and crypto operations.
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
  corsOrigins: ['http://localhost:5173'],
  jwtSecret: JWT_SECRET,
  jwtAccessExpiry: '15m',
  jwtRefreshExpiry: '7d',
  encryptionMasterKey: ENCRYPTION_MASTER_KEY,
};

const USER_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const WEBHOOK_ID = '99999999-9999-4999-8999-999999999999';

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
    getAllProviders: vi.fn().mockReturnValue([]),
    getProvider: vi.fn(),
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
import * as webhookService from '../../src/modules/enrichment/webhook.service';
import { NotFoundError } from '../../src/shared/errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAccessToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

/** Mock RBAC: db.query returns a role row for the workspace membership check */
function mockRbacRole(role: string): void {
  vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role }] } as never);
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const mockSubscription = {
  id: WEBHOOK_ID,
  workspaceId: WORKSPACE_ID,
  callbackUrl: 'https://example.com/webhook',
  eventTypes: ['job.completed', 'job.failed'],
  secretKey: 'a'.repeat(64),
  isActive: true,
  createdBy: USER_ID,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// ─── Test suite ───────────────────────────────────────────────────────────────

const app = createApp(APP_CONFIG);
const token = makeAccessToken(USER_ID);

describe('Integration: Webhook API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiterState();
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never);
  });

  // ─── POST /api/v1/workspaces/:id/webhooks ───────────────────────────────

  describe('POST /api/v1/workspaces/:id/webhooks', () => {
    const url = `/api/v1/workspaces/${WORKSPACE_ID}/webhooks`;
    const validBody = {
      callbackUrl: 'https://example.com/webhook',
      eventTypes: ['job.completed', 'job.failed'],
    };

    it('should create a webhook subscription and return 201 (admin)', async () => {
      mockRbacRole('admin');
      vi.mocked(webhookService.createSubscription).mockResolvedValueOnce(mockSubscription);

      const res = await request(app)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(WEBHOOK_ID);
      expect(res.body.data.callbackUrl).toBe('https://example.com/webhook');
      expect(res.body.data.eventTypes).toEqual(['job.completed', 'job.failed']);
      expect(webhookService.createSubscription).toHaveBeenCalledWith(
        WORKSPACE_ID,
        USER_ID,
        'https://example.com/webhook',
        ['job.completed', 'job.failed'],
      );
    });

    it('should return 400 on invalid body (missing callbackUrl)', async () => {
      const res = await request(app)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .send({ eventTypes: ['job.completed'] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 on invalid body (missing eventTypes)', async () => {
      const res = await request(app)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .send({ callbackUrl: 'https://example.com/webhook' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 403 when member tries to create webhook (RBAC)', async () => {
      mockRbacRole('member');

      const res = await request(app)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .send(validBody);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── GET /api/v1/workspaces/:id/webhooks ────────────────────────────────

  describe('GET /api/v1/workspaces/:id/webhooks', () => {
    const url = `/api/v1/workspaces/${WORKSPACE_ID}/webhooks`;

    it('should list webhook subscriptions and return 200 (member)', async () => {
      mockRbacRole('member');
      vi.mocked(webhookService.listSubscriptions).mockResolvedValueOnce([mockSubscription]);

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(WEBHOOK_ID);
      expect(webhookService.listSubscriptions).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    it('should return empty array when no subscriptions exist', async () => {
      mockRbacRole('member');
      vi.mocked(webhookService.listSubscriptions).mockResolvedValueOnce([]);

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ─── DELETE /api/v1/workspaces/:id/webhooks/:webhookId ──────────────────

  describe('DELETE /api/v1/workspaces/:id/webhooks/:webhookId', () => {
    const url = `/api/v1/workspaces/${WORKSPACE_ID}/webhooks/${WEBHOOK_ID}`;

    it('should delete a webhook subscription and return 200 (admin)', async () => {
      mockRbacRole('admin');
      vi.mocked(webhookService.deleteSubscription).mockResolvedValueOnce(undefined);

      const res = await request(app)
        .delete(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBe('Webhook subscription deleted');
      expect(webhookService.deleteSubscription).toHaveBeenCalledWith(WORKSPACE_ID, WEBHOOK_ID);
    });

    it('should return 403 when member tries to delete webhook (RBAC)', async () => {
      mockRbacRole('member');

      const res = await request(app)
        .delete(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 when webhook subscription does not exist', async () => {
      mockRbacRole('admin');
      vi.mocked(webhookService.deleteSubscription).mockRejectedValueOnce(
        new NotFoundError(`Webhook subscription ${WEBHOOK_ID} not found`),
      );

      const res = await request(app)
        .delete(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
