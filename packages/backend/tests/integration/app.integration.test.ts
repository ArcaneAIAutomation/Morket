/**
 * Integration tests for end-to-end HTTP flows.
 *
 * Strategy: mock all repository modules and shared/db so no real database is needed.
 * The app factory (createApp) wires everything together — we test the full HTTP layer.
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

// Real UUIDs for test fixtures (pass Zod uuid() validation)
const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER_2_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const CRED_ID = '44444444-4444-4444-8444-444444444444';

// ─── Mock: shared/db ──────────────────────────────────────────────────────────
// rbac.ts calls query() directly; workspace.service and credit.service use getPool().connect()

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../../src/shared/db', () => ({
  // Default: return empty rows — individual tests override with mockResolvedValueOnce
  getPool: vi.fn(() => ({ connect: vi.fn().mockResolvedValue(mockClient) })),
  query: vi.fn().mockResolvedValue({ rows: [] }),
  setPool: vi.fn(),
  initPool: vi.fn(),
  closePool: vi.fn(),
}));

// ─── Mock: user.repository ────────────────────────────────────────────────────

vi.mock('../../src/modules/auth/user.repository', () => ({
  createUser: vi.fn(),
  findByEmail: vi.fn(),
  findById: vi.fn(),
}));

// ─── Mock: token.repository ───────────────────────────────────────────────────

vi.mock('../../src/modules/auth/token.repository', () => ({
  createToken: vi.fn(),
  findByTokenHash: vi.fn(),
  revokeById: vi.fn(),
  revokeAllForUser: vi.fn(),
}));

// ─── Mock: workspace.repository ───────────────────────────────────────────────

vi.mock('../../src/modules/workspace/workspace.repository', () => ({
  createWorkspace: vi.fn(),
  findById: vi.fn(),
  findAllForUser: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  generateSlug: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-') + '-abc123'),
}));

// ─── Mock: membership.repository ─────────────────────────────────────────────

vi.mock('../../src/modules/workspace/membership.repository', () => ({
  create: vi.fn(),
  findByUserAndWorkspace: vi.fn(),
  findAllForWorkspace: vi.fn(),
  updateRole: vi.fn(),
  deleteMembership: vi.fn(),
  countOwners: vi.fn(),
}));

// ─── Mock: credential.repository ─────────────────────────────────────────────

vi.mock('../../src/modules/credential/credential.repository', () => ({
  create: vi.fn(),
  findById: vi.fn(),
  findAllByWorkspace: vi.fn(),
  deleteCredential: vi.fn(),
  updateLastUsed: vi.fn(),
}));

// ─── Mock: billing.repository ─────────────────────────────────────────────────

vi.mock('../../src/modules/credit/billing.repository', () => ({
  create: vi.fn(),
  findByWorkspaceId: vi.fn(),
  updateBalance: vi.fn(),
  updateAutoRecharge: vi.fn(),
}));

// ─── Mock: transaction.repository ────────────────────────────────────────────

vi.mock('../../src/modules/credit/transaction.repository', () => ({
  create: vi.fn(),
  findByWorkspaceId: vi.fn(),
}));

// ─── Import mocks after vi.mock declarations ──────────────────────────────────

import * as userRepo from '../../src/modules/auth/user.repository';
import * as tokenRepo from '../../src/modules/auth/token.repository';
import * as workspaceRepo from '../../src/modules/workspace/workspace.repository';
import * as membershipRepo from '../../src/modules/workspace/membership.repository';
import * as credentialRepo from '../../src/modules/credential/credential.repository';
import * as billingRepo from '../../src/modules/credit/billing.repository';
import * as txnRepo from '../../src/modules/credit/transaction.repository';
import * as db from '../../src/shared/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAccessToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

const NOW = new Date('2024-01-01T00:00:00Z');

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'alice@example.com',
    passwordHash: '$2b$12$hashedpassword',
    name: 'Alice',
    avatarUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKSPACE_ID,
    name: 'Test Workspace',
    slug: 'test-workspace-abc123',
    ownerId: USER_ID,
    planType: 'free' as const,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeMembership(userId: string, workspaceId: string, role: string) {
  return {
    userId,
    workspaceId,
    role,
    invitedAt: NOW,
    acceptedAt: NOW,
  };
}

function makeRefreshToken(userId: string, tokenHash: string) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    createdAt: NOW,
  };
}

function makeBillingRecord(workspaceId: string, balance = 0) {
  return {
    workspaceId,
    planType: 'free' as const,
    creditBalance: balance,
    creditLimit: 1000,
    billingCycleStart: NOW,
    billingCycleEnd: new Date('2024-02-01T00:00:00Z'),
    autoRecharge: false,
    autoRechargeThreshold: 0,
    autoRechargeAmount: 0,
  };
}

function makeTransaction(workspaceId: string, amount: number, type: string) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    workspaceId,
    amount,
    transactionType: type,
    description: 'Test transaction',
    referenceId: null,
    createdAt: NOW,
  };
}

// ─── App instance (shared across tests) ──────────────────────────────────────

const app = createApp(APP_CONFIG);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Integration: End-to-End Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiterState();

    // Re-establish default implementations after clearAllMocks wipes queued values
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never);
    mockClient.query.mockResolvedValue({ rows: [] });
    mockClient.release.mockReturnValue(undefined);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: Full happy-path flow
  // ──────────────────────────────────────────────────────────────────────────

  describe('Test 1: Happy-path flow', () => {
    it('registers a new user and returns 201 with userId', async () => {
      const user = makeUser();
      vi.mocked(userRepo.findByEmail).mockResolvedValue(null);
      vi.mocked(userRepo.createUser).mockResolvedValue(user as never);

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'alice@example.com', password: 'Password123!', name: 'Alice' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(USER_ID);
      expect(res.body.data.email).toBe('alice@example.com');
      // password hash must never be in the response
      expect(res.body.data.passwordHash).toBeUndefined();
    });

    it('logs in and returns accessToken + refreshToken', async () => {
      const bcrypt = await import('bcrypt');
      const user = makeUser({ passwordHash: await bcrypt.hash('Password123!', 1) });

      vi.mocked(userRepo.findByEmail).mockResolvedValue(user as never);
      vi.mocked(tokenRepo.createToken).mockResolvedValue(makeRefreshToken(USER_ID, 'hash') as never);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'Password123!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();

      // Verify the access token contains the correct userId
      const decoded = jwt.verify(res.body.data.accessToken, JWT_SECRET) as { userId: string };
      expect(decoded.userId).toBe(USER_ID);
    });

    it('creates a workspace and returns 201 with workspaceId', async () => {
      const accessToken = makeAccessToken(USER_ID);

      // workspace.service.create() uses getPool().connect() for a transaction
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({             // INSERT workspaces
          rows: [{
            id: WORKSPACE_ID,
            name: 'Test Workspace',
            slug: 'test-workspace-abc123',
            owner_id: USER_ID,
            plan_type: 'free',
            created_at: NOW,
            updated_at: NOW,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }) // INSERT workspace_memberships
        .mockResolvedValueOnce({ rows: [] }) // INSERT billing
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const res = await request(app)
        .post('/api/v1/workspaces')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Test Workspace' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(WORKSPACE_ID);
      expect(res.body.data.name).toBe('Test Workspace');
    });

    it('adds a member to the workspace and returns 201', async () => {
      const accessToken = makeAccessToken(USER_ID);
      const memberUser = makeUser({ id: USER_2_ID, email: 'bob@example.com', name: 'Bob' });
      const membership = makeMembership(USER_2_ID, WORKSPACE_ID, 'admin');

      // RBAC check: owner role for USER_ID in WORKSPACE_ID
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role: 'owner' }] } as never);

      vi.mocked(userRepo.findByEmail).mockResolvedValue(memberUser as never);
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(null);
      vi.mocked(membershipRepo.create).mockResolvedValue(membership as never);

      const res = await request(app)
        .post(`/api/v1/workspaces/${WORKSPACE_ID}/members`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: 'bob@example.com', role: 'admin' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userId).toBe(USER_2_ID);
      expect(res.body.data.role).toBe('admin');
    });

    it('stores a credential and returns 201 with masked response (no raw key)', async () => {
      const accessToken = makeAccessToken(USER_ID);

      // RBAC check: owner role for USER_ID in WORKSPACE_ID
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role: 'owner' }] } as never);

      const storedCred = {
        id: CRED_ID,
        workspaceId: WORKSPACE_ID,
        providerName: 'openai',
        encryptedKey: 'enc-key',
        encryptedSecret: 'iv:tag:enc-secret',
        iv: 'some-iv',
        authTag: 'some-tag',
        createdBy: USER_ID,
        createdAt: NOW,
        lastUsedAt: null,
      };
      vi.mocked(credentialRepo.create).mockResolvedValue(storedCred as never);

      const res = await request(app)
        .post(`/api/v1/workspaces/${WORKSPACE_ID}/credentials`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ providerName: 'openai', key: 'sk-abcdefgh1234', secret: 'my-secret-value' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      // Raw key/secret must not appear in response
      expect(JSON.stringify(res.body)).not.toContain('sk-abcdefgh1234');
      expect(JSON.stringify(res.body)).not.toContain('my-secret-value');
    });

    it('adds credits to workspace and returns 201 with transaction', async () => {
      const accessToken = makeAccessToken(USER_ID);
      const transaction = makeTransaction(WORKSPACE_ID, 500, 'purchase');

      // RBAC check: owner role for USER_ID in WORKSPACE_ID
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role: 'owner' }] } as never);

      // credit.service.addCredits uses getPool().connect() for a transaction
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })                               // BEGIN
        .mockResolvedValueOnce({ rows: [{ credit_balance: 0 }] })         // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] })                               // COMMIT (after mocked repo calls)
        .mockResolvedValueOnce({ rows: [] });                              // release

      vi.mocked(billingRepo.updateBalance).mockResolvedValue(makeBillingRecord(WORKSPACE_ID, 500) as never);
      vi.mocked(txnRepo.create).mockResolvedValue(transaction as never);

      const res = await request(app)
        .post(`/api/v1/workspaces/${WORKSPACE_ID}/billing/credits`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ amount: 500, description: 'Top up' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('lists transactions and returns 200 with paginated result', async () => {
      const accessToken = makeAccessToken(USER_ID);
      const transactions = [
        makeTransaction(WORKSPACE_ID, 500, 'purchase'),
        makeTransaction(WORKSPACE_ID, -100, 'usage'),
      ];

      // RBAC check: owner role for USER_ID in WORKSPACE_ID
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role: 'owner' }] } as never);

      vi.mocked(txnRepo.findByWorkspaceId).mockResolvedValue({
        items: transactions as never,
        total: 2,
        page: 1,
        limit: 20,
      });

      const res = await request(app)
        .get(`/api/v1/workspaces/${WORKSPACE_ID}/billing/transactions?page=1&limit=20`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: 2 });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: RBAC enforcement
  // ──────────────────────────────────────────────────────────────────────────

  describe('Test 2: RBAC enforcement', () => {
    it('viewer cannot POST credentials (403)', async () => {
      const viewerToken = makeAccessToken(USER_2_ID);

      // RBAC check: viewer role — insufficient for admin+ endpoint
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role: 'viewer' }] } as never);

      const res = await request(app)
        .post(`/api/v1/workspaces/${WORKSPACE_ID}/credentials`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ providerName: 'openai', key: 'sk-test1234', secret: 'secret' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
    });

    it('member cannot DELETE workspace (403)', async () => {
      const memberToken = makeAccessToken(USER_2_ID);

      // RBAC check: member role — insufficient for owner-only endpoint
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role: 'member' }] } as never);

      const res = await request(app)
        .delete(`/api/v1/workspaces/${WORKSPACE_ID}`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
    });

    it('admin cannot POST billing/credits (403) — owner only', async () => {
      const adminToken = makeAccessToken(USER_2_ID);

      // RBAC check: admin role — insufficient for owner-only billing endpoint
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role: 'admin' }] } as never);

      const res = await request(app)
        .post(`/api/v1/workspaces/${WORKSPACE_ID}/billing/credits`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, description: 'Top up' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
    });

    it('non-member gets 403 on any workspace resource', async () => {
      const outsiderToken = makeAccessToken(USER_2_ID);

      // RBAC check: no membership found
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as never);

      const res = await request(app)
        .get(`/api/v1/workspaces/${WORKSPACE_ID}`)
        .set('Authorization', `Bearer ${outsiderToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: Rate limiting on auth routes
  // ──────────────────────────────────────────────────────────────────────────

  describe('Test 3: Rate limiting', () => {
    it('first 5 auth requests succeed (or fail with 401, not 429), 6th returns 429', async () => {
      // Reset ensures no leftover timestamps from previous tests bleed in
      _resetRateLimiterState();

      // Each login attempt: user not found → 401 (not 429)
      vi.mocked(userRepo.findByEmail).mockResolvedValue(null);

      const results: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({ email: `user${i}@example.com`, password: 'wrong' });
        results.push(res.status);
      }

      // All 5 should be 401 (invalid credentials), not 429
      for (const status of results) {
        expect(status).not.toBe(429);
      }

      // 6th request should be rate-limited
      const sixthRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'user6@example.com', password: 'wrong' });

      expect(sixthRes.status).toBe(429);
      expect(sixthRes.body.success).toBe(false);
      expect(sixthRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: Invalid auth token
  // ──────────────────────────────────────────────────────────────────────────

  describe('Test 4: Invalid auth token', () => {
    it('request with no token returns 401', async () => {
      const res = await request(app).get('/api/v1/workspaces');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('request with malformed token returns 401', async () => {
      const res = await request(app)
        .get('/api/v1/workspaces')
        .set('Authorization', 'Bearer not.a.valid.jwt.token');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('request with token signed by wrong secret returns 401', async () => {
      const badToken = jwt.sign({ userId: USER_ID }, 'wrong-secret-that-is-also-long-enough');

      const res = await request(app)
        .get('/api/v1/workspaces')
        .set('Authorization', `Bearer ${badToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
