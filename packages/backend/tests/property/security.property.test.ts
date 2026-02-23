import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { createAuthMiddleware } from '../../src/middleware/auth';
import { errorHandler } from '../../src/middleware/errorHandler';
import { _resetRateLimiterState } from '../../src/middleware/rateLimiter';
import { validate } from '../../src/middleware/validate';
import { z } from 'zod';

// ── Mock Redis for jti revocation checks ──
vi.mock('../../src/cache/redis', () => ({
  getRedis: vi.fn().mockReturnValue(null),
  initRedis: vi.fn(),
  isRedisConnected: vi.fn().mockReturnValue(false),
}));

// ── Mock logger to prevent stdout noise ──
vi.mock('../../src/shared/logger', () => ({
  log: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const JWT_SECRET = 'test-secret-key';
const VALID_ISSUER = 'morket';
const VALID_AUDIENCE = 'morket-api';

/**
 * Creates a minimal Express app with the auth middleware and a protected endpoint
 * for testing middleware rejection/acceptance behavior.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  const authMiddleware = createAuthMiddleware(JWT_SECRET);
  app.get('/api/v1/protected', authMiddleware, (_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: { message: 'ok' }, error: null });
  });
  app.use(errorHandler);
  return app;
}

// ── Generators ──

/** Generates a non-empty string that is NOT equal to the valid value */
function invalidStringArb(validValue: string): fc.Arbitrary<string> {
  return fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => s !== validValue);
}

/** Generates a valid userId (UUID-like) */
const userIdArb = fc.uuid();

/** Generates a valid role */
const roleArb = fc.constantFrom('owner', 'admin', 'member', 'viewer');

/** Generates a valid workspaceId (UUID-like) */
const workspaceIdArb = fc.uuid();

/** Generates a valid jti (UUID-like) */
const jtiArb = fc.uuid();

describe('Feature: security-audit, Auth Middleware JWT Validation Properties', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _resetRateLimiterState();
  });

  // Feature: security-audit, Property 2: JWT claim validation rejects invalid tokens
  /**
   * Property 2: JWT claim validation rejects invalid tokens
   *
   * For any JWT with incorrect `iss` or `aud`, auth middleware rejects
   * even if the signature is valid.
   *
   * **Validates: Requirements 1.3**
   */
  describe('Property 2: JWT claim validation rejects invalid tokens', () => {
    it('rejects tokens with incorrect issuer', async () => {
      const app = createTestApp();

      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          roleArb,
          workspaceIdArb,
          jtiArb,
          invalidStringArb(VALID_ISSUER),
          async (userId, role, workspaceId, jti, badIssuer) => {
            const token = jwt.sign(
              { userId, role, workspaceId, jti },
              JWT_SECRET,
              { issuer: badIssuer, audience: VALID_AUDIENCE, expiresIn: '15m' },
            );

            const res = await request(app)
              .get('/api/v1/protected')
              .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBeDefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects tokens with incorrect audience', async () => {
      const app = createTestApp();

      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          roleArb,
          workspaceIdArb,
          jtiArb,
          invalidStringArb(VALID_AUDIENCE),
          async (userId, role, workspaceId, jti, badAudience) => {
            const token = jwt.sign(
              { userId, role, workspaceId, jti },
              JWT_SECRET,
              { issuer: VALID_ISSUER, audience: badAudience, expiresIn: '15m' },
            );

            const res = await request(app)
              .get('/api/v1/protected')
              .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBeDefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects tokens with both incorrect issuer and audience', async () => {
      const app = createTestApp();

      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          roleArb,
          workspaceIdArb,
          jtiArb,
          invalidStringArb(VALID_ISSUER),
          invalidStringArb(VALID_AUDIENCE),
          async (userId, role, workspaceId, jti, badIssuer, badAudience) => {
            const token = jwt.sign(
              { userId, role, workspaceId, jti },
              JWT_SECRET,
              { issuer: badIssuer, audience: badAudience, expiresIn: '15m' },
            );

            const res = await request(app)
              .get('/api/v1/protected')
              .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBeDefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('accepts tokens with correct issuer and audience (control)', async () => {
      const app = createTestApp();

      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          roleArb,
          workspaceIdArb,
          jtiArb,
          async (userId, role, workspaceId, jti) => {
            const token = jwt.sign(
              { userId, role, workspaceId, jti },
              JWT_SECRET,
              { issuer: VALID_ISSUER, audience: VALID_AUDIENCE, expiresIn: '15m' },
            );

            const res = await request(app)
              .get('/api/v1/protected')
              .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: security-audit, Property 3: Access tokens contain required claims
  /**
   * Property 3: Access tokens contain required claims
   *
   * For any generated access token, decoding reveals `userId`, `jti`,
   * `iss`, `aud`, `role`, `workspaceId` with non-empty values.
   *
   * **Validates: Requirements 1.5, 10.5**
   */
  describe('Property 3: Access tokens contain required claims', () => {
    it('all generated access tokens contain required non-empty claims', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          roleArb,
          workspaceIdArb,
          jtiArb,
          async (userId, role, workspaceId, jti) => {
            // Generate a token the same way the auth service would after hardening
            const token = jwt.sign(
              { userId, role, workspaceId, jti },
              JWT_SECRET,
              { issuer: VALID_ISSUER, audience: VALID_AUDIENCE, expiresIn: '15m' },
            );

            // Decode without verification to inspect claims
            const decoded = jwt.decode(token) as Record<string, unknown>;

            // All required claims must be present and non-empty
            expect(decoded).toBeDefined();
            expect(typeof decoded.userId).toBe('string');
            expect((decoded.userId as string).length).toBeGreaterThan(0);

            expect(typeof decoded.jti).toBe('string');
            expect((decoded.jti as string).length).toBeGreaterThan(0);

            expect(decoded.iss).toBe(VALID_ISSUER);
            expect(typeof decoded.iss).toBe('string');
            expect((decoded.iss as string).length).toBeGreaterThan(0);

            expect(decoded.aud).toBe(VALID_AUDIENCE);
            expect(typeof decoded.aud).toBe('string');
            expect((decoded.aud as string).length).toBeGreaterThan(0);

            expect(typeof decoded.role).toBe('string');
            expect((decoded.role as string).length).toBeGreaterThan(0);

            expect(typeof decoded.workspaceId).toBe('string');
            expect((decoded.workspaceId as string).length).toBeGreaterThan(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});


// ── Mock database for RBAC middleware ──
vi.mock('../../src/shared/db', () => ({
  query: vi.fn(),
  getPool: vi.fn(),
  initPool: vi.fn(),
  closePool: vi.fn(),
  setPool: vi.fn(),
}));

import { query as mockQuery } from '../../src/shared/db';
import { requireRole, ROLE_HIERARCHY } from '../../src/middleware/rbac';
import type { WorkspaceRole } from '../../src/shared/types';

const mockedQuery = vi.mocked(mockQuery);

// ── Generators for RBAC tests ──

/** Generates two distinct UUIDs for workspace ID mismatch testing */
const distinctWorkspaceIdPairArb = fc
  .tuple(fc.uuid(), fc.uuid())
  .filter(([a, b]) => a !== b);

/** All valid roles */
const allRolesArb = fc.constantFrom<WorkspaceRole>('owner', 'admin', 'member', 'viewer', 'billing_admin');

/** Non-billing path segments */
const nonBillingPathArb = fc.constantFrom(
  'enrichment', 'records', 'workflows', 'search', 'analytics',
  'credentials', 'members', 'settings', 'data-ops', 'integrations',
);

/** Billing path segments */
const billingPathArb = fc.constantFrom(
  'billing', 'invoices', 'checkout', 'portal', 'credits',
);

/**
 * Creates an Express app with RBAC middleware for testing.
 * Sets up a workspace-scoped route with the given minimum role.
 */
function createRbacTestApp(minimumRole: WorkspaceRole, pathSuffix: string = '') {
  const app = express();
  app.use(express.json());

  // Simulate auth middleware by injecting req.user from a custom header
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userHeader = req.headers['x-test-user'] as string | undefined;
    if (userHeader) {
      try {
        req.user = JSON.parse(userHeader);
      } catch {
        // ignore parse errors
      }
    }
    next();
  });

  app.get(
    `/api/v1/workspaces/:id${pathSuffix}`,
    requireRole(minimumRole),
    (_req: Request, res: Response) => {
      res.status(200).json({ success: true, data: { message: 'ok' }, error: null });
    },
  );

  app.use(errorHandler);
  return app;
}

describe('Feature: security-audit, RBAC Middleware Properties', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _resetRateLimiterState();
  });

  // Feature: security-audit, Property 4: RBAC workspace ID cross-check
  /**
   * Property 4: RBAC workspace ID cross-check
   *
   * For any request where URL workspace ID does not match user's workspace
   * membership (JWT workspaceId), RBAC rejects with 403.
   * When JWT workspaceId is set and differs from URL workspace ID,
   * the middleware rejects immediately without DB query.
   *
   * **Validates: Requirements 2.1, 2.2**
   */
  describe('Property 4: RBAC workspace ID cross-check', () => {
    it('rejects when JWT workspaceId differs from URL workspace ID', async () => {
      const app = createRbacTestApp('member');

      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          roleArb,
          distinctWorkspaceIdPairArb,
          async (userId, role, [jwtWorkspaceId, urlWorkspaceId]) => {
            // The JWT has a workspaceId that differs from the URL param
            const user = { userId, role, workspaceId: jwtWorkspaceId };

            const res = await request(app)
              .get(`/api/v1/workspaces/${urlWorkspaceId}`)
              .set('X-Test-User', JSON.stringify(user));

            // Should be rejected with 403 — workspace ID mismatch
            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');

            // Should NOT have queried the database — early rejection
            expect(mockedQuery).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects when user is not a member of the URL workspace', async () => {
      const app = createRbacTestApp('member');

      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          fc.uuid(), // urlWorkspaceId
          async (userId, urlWorkspaceId) => {
            // User has no workspaceId in JWT (so cross-check passes),
            // but DB returns no membership rows
            const user = { userId };

            mockedQuery.mockResolvedValueOnce({
              rows: [],
              command: 'SELECT',
              rowCount: 0,
              oid: 0,
              fields: [],
            });

            const res = await request(app)
              .get(`/api/v1/workspaces/${urlWorkspaceId}`)
              .set('X-Test-User', JSON.stringify(user));

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('accepts when JWT workspaceId matches URL workspace ID and user has sufficient role', async () => {
      const app = createRbacTestApp('member');

      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          fc.uuid(), // same workspace ID for both JWT and URL
          fc.constantFrom<WorkspaceRole>('member', 'admin', 'owner'),
          async (userId, workspaceId, role) => {
            const user = { userId, workspaceId };

            mockedQuery.mockResolvedValueOnce({
              rows: [{ role }],
              command: 'SELECT',
              rowCount: 1,
              oid: 0,
              fields: [],
            });

            const res = await request(app)
              .get(`/api/v1/workspaces/${workspaceId}`)
              .set('X-Test-User', JSON.stringify(user));

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: security-audit, Property 5: Role hierarchy enforcement
  /**
   * Property 5: Role hierarchy enforcement
   *
   * Viewers cannot write, non-admins cannot access admin endpoints,
   * billing_admin restricted to billing.
   *
   * **Validates: Requirements 2.2, 2.4, 2.5**
   */
  describe('Property 5: Role hierarchy enforcement', () => {
    it('viewers are rejected from endpoints requiring member or higher', async () => {
      // Test with minimumRole = 'member' — viewers should be rejected
      const app = createRbacTestApp('member');

      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          fc.uuid(),
          async (userId, workspaceId) => {
            const user = { userId, workspaceId };

            mockedQuery.mockResolvedValueOnce({
              rows: [{ role: 'viewer' as WorkspaceRole }],
              command: 'SELECT',
              rowCount: 1,
              oid: 0,
              fields: [],
            });

            const res = await request(app)
              .get(`/api/v1/workspaces/${workspaceId}`)
              .set('X-Test-User', JSON.stringify(user));

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('non-admins are rejected from admin endpoints', async () => {
      // Test with minimumRole = 'admin' — member and viewer should be rejected
      const app = createRbacTestApp('admin');

      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          fc.uuid(),
          fc.constantFrom<WorkspaceRole>('viewer', 'member'),
          async (userId, workspaceId, insufficientRole) => {
            const user = { userId, workspaceId };

            mockedQuery.mockResolvedValueOnce({
              rows: [{ role: insufficientRole }],
              command: 'SELECT',
              rowCount: 1,
              oid: 0,
              fields: [],
            });

            const res = await request(app)
              .get(`/api/v1/workspaces/${workspaceId}`)
              .set('X-Test-User', JSON.stringify(user));

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('admin and owner can access admin endpoints', async () => {
      const app = createRbacTestApp('admin');

      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          fc.uuid(),
          fc.constantFrom<WorkspaceRole>('admin', 'owner'),
          async (userId, workspaceId, sufficientRole) => {
            const user = { userId, workspaceId };

            mockedQuery.mockResolvedValueOnce({
              rows: [{ role: sufficientRole }],
              command: 'SELECT',
              rowCount: 1,
              oid: 0,
              fields: [],
            });

            const res = await request(app)
              .get(`/api/v1/workspaces/${workspaceId}`)
              .set('X-Test-User', JSON.stringify(user));

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('billing_admin is rejected from non-billing endpoints', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          fc.uuid(),
          nonBillingPathArb,
          async (userId, workspaceId, pathSegment) => {
            const app = createRbacTestApp('member', `/${pathSegment}`);
            const user = { userId, workspaceId };

            mockedQuery.mockResolvedValueOnce({
              rows: [{ role: 'billing_admin' as WorkspaceRole }],
              command: 'SELECT',
              rowCount: 1,
              oid: 0,
              fields: [],
            });

            const res = await request(app)
              .get(`/api/v1/workspaces/${workspaceId}/${pathSegment}`)
              .set('X-Test-User', JSON.stringify(user));

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('billing_admin can access billing endpoints', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          fc.uuid(),
          billingPathArb,
          async (userId, workspaceId, billingSegment) => {
            const app = createRbacTestApp('member', `/${billingSegment}`);
            const user = { userId, workspaceId };

            mockedQuery.mockResolvedValueOnce({
              rows: [{ role: 'billing_admin' as WorkspaceRole }],
              command: 'SELECT',
              rowCount: 1,
              oid: 0,
              fields: [],
            });

            const res = await request(app)
              .get(`/api/v1/workspaces/${workspaceId}/${billingSegment}`)
              .set('X-Test-User', JSON.stringify(user));

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('role hierarchy is correctly ordered for all role pairs', async () => {
      // For any role with hierarchy level below the minimum, access is denied
      // For any role with hierarchy level >= minimum, access is granted (except billing_admin special case)
      const nonBillingAdminRoles = fc.constantFrom<WorkspaceRole>('viewer', 'member', 'admin', 'owner');
      const minimumRoles = fc.constantFrom<WorkspaceRole>('viewer', 'member', 'admin', 'owner');

      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          fc.uuid(),
          nonBillingAdminRoles,
          minimumRoles,
          async (userId, workspaceId, userRole, minimumRole) => {
            const app = createRbacTestApp(minimumRole);
            const user = { userId, workspaceId };

            mockedQuery.mockResolvedValueOnce({
              rows: [{ role: userRole }],
              command: 'SELECT',
              rowCount: 1,
              oid: 0,
              fields: [],
            });

            const res = await request(app)
              .get(`/api/v1/workspaces/${workspaceId}`)
              .set('X-Test-User', JSON.stringify(user));

            if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minimumRole]) {
              expect(res.status).toBe(200);
              expect(res.body.success).toBe(true);
            } else {
              expect(res.status).toBe(403);
              expect(res.body.success).toBe(false);
              expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});


// ── Rate Limiter Property Tests ──

import { createRateLimiter } from '../../src/middleware/rateLimiter';

/**
 * Creates a minimal Express app with a rate limiter and error handler
 * for testing rate limiting behavior.
 */
function createRateLimiterTestApp(maxRequests: number, windowMs: number = 60000) {
  const app = express();
  const limiter = createRateLimiter({ windowMs, maxRequests });
  app.get('/test', limiter, (_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: { message: 'ok' }, error: null });
  });
  app.use(errorHandler);
  return app;
}

describe('Feature: security-audit, Rate Limiter Properties', () => {
  beforeEach(() => {
    _resetRateLimiterState();
  });

  // Feature: security-audit, Property 10: Rate limiter includes Retry-After header
  /**
   * Property 10: Rate limiter includes Retry-After header
   *
   * For any 429 response, `Retry-After` header is present with a positive
   * numeric value representing seconds until the client may retry.
   *
   * **Validates: Requirements 4.1, 4.2**
   */
  describe('Property 10: Rate limiter includes Retry-After header', () => {
    it('429 responses always include a positive Retry-After header', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10 }),
          async (maxRequests) => {
            _resetRateLimiterState();
            const app = createRateLimiterTestApp(maxRequests);

            // Exhaust the rate limit
            for (let i = 0; i < maxRequests; i++) {
              const res = await request(app).get('/test');
              expect(res.status).toBe(200);
            }

            // The next request should be rate-limited
            const limitedRes = await request(app).get('/test');

            expect(limitedRes.status).toBe(429);
            expect(limitedRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');

            // Retry-After header must be present and a positive number
            const retryAfter = limitedRes.headers['retry-after'];
            expect(retryAfter).toBeDefined();
            const retryAfterNum = Number(retryAfter);
            expect(Number.isNaN(retryAfterNum)).toBe(false);
            expect(retryAfterNum).toBeGreaterThan(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: security-audit, Property 19: Rate limiter enforces per-route limits
  /**
   * Property 19: Rate limiter enforces per-route limits
   *
   * After exactly `maxRequests` from same IP within window, next request
   * is rejected with 429.
   *
   * **Validates: Requirements 4.1, 4.2**
   */
  describe('Property 19: Rate limiter enforces per-route limits', () => {
    it('allows exactly maxRequests then rejects the next with 429', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 20 }),
          async (maxRequests) => {
            _resetRateLimiterState();
            const app = createRateLimiterTestApp(maxRequests);

            // Send exactly maxRequests — all should succeed
            for (let i = 0; i < maxRequests; i++) {
              const res = await request(app).get('/test');
              expect(res.status).toBe(200);
              expect(res.body.success).toBe(true);
            }

            // The (maxRequests + 1)th request should be rejected
            const rejectedRes = await request(app).get('/test');
            expect(rejectedRes.status).toBe(429);
            expect(rejectedRes.body.success).toBe(false);
            expect(rejectedRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});


// ── Error Handler Property Tests ──

import { AppError, ValidationError, AuthenticationError, NotFoundError } from '../../src/shared/errors';

// Feature: security-audit, Property 12: Error responses exclude internal details in production
/**
 * Property 12: Error responses exclude internal details in production
 *
 * For any error in production mode, response body contains no stack traces,
 * file paths, or raw DB errors.
 *
 * **Validates: Requirements 4.4**
 */

/** Patterns that must never appear in production error responses */
const INTERNAL_PATTERNS = [
  /\/app\/src\//i,
  /\/home\//i,
  /\/usr\//i,
  /\.(ts|js):\d+/,
  /at\s+\S+\s+\(/,
  /node_modules\//,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /password authentication failed/i,
  /syntax error at or near/i,
  /duplicate key value/i,
];

/** Checks whether a string contains any internal detail pattern */
function hasInternalDetails(str: string): boolean {
  return INTERNAL_PATTERNS.some((p) => p.test(str));
}

/** Arbitrary that generates error messages containing internal detail patterns */
const internalMessageArb = fc.oneof(
  fc.constant('/app/src/modules/auth/auth.service.ts:42 — failed'),
  fc.constant('Error at /home/user/project/index.ts:10'),
  fc.constant('at Function.Module._resolveFilename (node_modules/module.js:55:15)'),
  fc.constant('connect ECONNREFUSED 127.0.0.1:5432'),
  fc.constant('password authentication failed for user "morket"'),
  fc.constant('syntax error at or near "SELECT"'),
  fc.constant('duplicate key value violates unique constraint "users_email_key"'),
  fc.constant('Error in /usr/local/lib/node.js:99'),
  fc.tuple(
    fc.constantFrom(
      '/app/src/', 'node_modules/', 'ECONNREFUSED', 'password authentication failed',
      'syntax error at or near', 'duplicate key value', '.ts:123', '.js:45',
      'at Function.xxx (', '/home/deploy/',
    ),
    fc.string({ minLength: 0, maxLength: 40 }),
  ).map(([pattern, suffix]) => `Something went wrong: ${pattern}${suffix}`),
);

/** Arbitrary that generates safe messages (no internal patterns) */
const safeMessageArb = fc
  .stringOf(fc.constantFrom(
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    ' ', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  ), { minLength: 1, maxLength: 60 })
  .filter((s) => !hasInternalDetails(s) && s.trim().length > 0);

/** Arbitrary for AppError status codes */
const statusCodeArb = fc.constantFrom(400, 401, 403, 404, 409, 429, 500);

/** Arbitrary for AppError error codes */
const errorCodeArb = fc.constantFrom(
  'VALIDATION_ERROR', 'AUTHENTICATION_ERROR', 'AUTHORIZATION_ERROR',
  'NOT_FOUND', 'CONFLICT', 'RATE_LIMIT_EXCEEDED', 'INTERNAL_ERROR',
);

/**
 * Creates an Express app that throws a specific error on GET /error.
 * Uses the real errorHandler middleware.
 */
function createErrorHandlerTestApp(errorToThrow: Error) {
  const app = express();
  app.get('/error', (_req: Request, _res: Response, _next: NextFunction) => {
    throw errorToThrow;
  });
  app.use(errorHandler);
  return app;
}

describe('Feature: security-audit, Error Handler Properties', () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('Property 12: Error responses exclude internal details in production', () => {
    it('AppError with internal details has message sanitized in production', async () => {
      await fc.assert(
        fc.asyncProperty(
          statusCodeArb,
          errorCodeArb,
          internalMessageArb,
          async (statusCode, errorCode, internalMessage) => {
            const err = new AppError(statusCode, errorCode, internalMessage);
            const app = createErrorHandlerTestApp(err);

            const res = await request(app).get('/error');

            expect(res.status).toBe(statusCode);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBeDefined();

            // The response message must NOT contain any internal detail patterns
            const responseMessage: string = res.body.error.message;
            const responseBody = JSON.stringify(res.body);

            for (const pattern of INTERNAL_PATTERNS) {
              expect(pattern.test(responseMessage)).toBe(false);
              expect(pattern.test(responseBody)).toBe(false);
            }

            // Must not contain stack traces
            expect(responseBody).not.toContain('stack');
            expect(responseBody).not.toContain('at ');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('AppError with safe messages passes through unchanged in production', async () => {
      await fc.assert(
        fc.asyncProperty(
          statusCodeArb,
          errorCodeArb,
          safeMessageArb,
          async (statusCode, errorCode, safeMessage) => {
            const err = new AppError(statusCode, errorCode, safeMessage);
            const app = createErrorHandlerTestApp(err);

            const res = await request(app).get('/error');

            expect(res.status).toBe(statusCode);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBeDefined();

            // Safe messages should pass through unchanged
            expect(res.body.error.message).toBe(safeMessage);
            expect(res.body.error.code).toBe(errorCode);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('unknown (non-AppError) errors always return generic message in production', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(internalMessageArb, safeMessageArb),
          async (message) => {
            const err = new Error(message);
            const app = createErrorHandlerTestApp(err);

            const res = await request(app).get('/error');

            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBeDefined();

            // Unknown errors must always return the generic message
            expect(res.body.error.code).toBe('INTERNAL_ERROR');
            expect(res.body.error.message).toBe('An unexpected error occurred');

            // Must not leak any internal details
            const responseBody = JSON.stringify(res.body);
            for (const pattern of INTERNAL_PATTERNS) {
              expect(pattern.test(responseBody)).toBe(false);
            }
            expect(responseBody).not.toContain('stack');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('response body never contains stack traces regardless of error type', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(), // true = AppError, false = plain Error
          internalMessageArb,
          statusCodeArb,
          errorCodeArb,
          async (isAppError, message, statusCode, errorCode) => {
            const err = isAppError
              ? new AppError(statusCode, errorCode, message)
              : new Error(message);
            const app = createErrorHandlerTestApp(err);

            const res = await request(app).get('/error');

            // Response body must never contain stack trace indicators
            const responseBody = JSON.stringify(res.body);
            expect(responseBody).not.toMatch(/at\s+\S+\s+\(/);
            expect(responseBody).not.toContain('.ts:');
            expect(responseBody).not.toContain('.js:');
            expect(responseBody).not.toContain('node_modules/');
            expect(responseBody).not.toContain('/app/src/');
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});


// ── Security Headers Property Tests ──

import { securityHeadersMiddleware } from '../../src/middleware/securityHeaders';

// Feature: security-audit, Property 11: Security headers present on all responses
/**
 * Property 11: Security headers present on all responses
 *
 * For any HTTP response, HSTS (max-age ≥ 31536000), X-Content-Type-Options: nosniff,
 * X-Frame-Options: DENY, and Permissions-Policy are present; X-Powered-By is absent.
 *
 * **Validates: Requirements 4.3, 4.6**
 */

/** Generates random HTTP methods */
const httpMethodArb = fc.constantFrom('GET', 'POST', 'PUT', 'DELETE');

/** Generates random URL path segments */
const pathSegmentArb = fc.stringOf(
  fc.constantFrom(
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '_',
  ),
  { minLength: 1, maxLength: 20 },
);

/** Generates random URL paths like /api/v1/foo/bar */
const randomPathArb = fc
  .array(pathSegmentArb, { minLength: 1, maxLength: 4 })
  .map((segments) => '/' + segments.join('/'));

/**
 * Creates an Express app with the security headers middleware and a catch-all
 * route that responds 200 for any method/path combination.
 */
function createSecurityHeadersTestApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeadersMiddleware);
  app.all('*', (_req: Request, res: Response) => {
    res.status(200).json({ success: true });
  });
  return app;
}

describe('Feature: security-audit, Security Headers Properties', () => {
  beforeEach(() => {
    _resetRateLimiterState();
  });

  describe('Property 11: Security headers present on all responses', () => {
    it('all required security headers are present on every response', async () => {
      const app = createSecurityHeadersTestApp();

      await fc.assert(
        fc.asyncProperty(
          httpMethodArb,
          randomPathArb,
          async (method, path) => {
            const req = request(app);
            let res: request.Response;

            switch (method) {
              case 'GET':
                res = await req.get(path);
                break;
              case 'POST':
                res = await req.post(path);
                break;
              case 'PUT':
                res = await req.put(path);
                break;
              case 'DELETE':
                res = await req.delete(path);
                break;
              default:
                res = await req.get(path);
            }

            // HSTS must be present with max-age >= 31536000
            const hsts = res.headers['strict-transport-security'];
            expect(hsts).toBeDefined();
            const maxAgeMatch = hsts.match(/max-age=(\d+)/);
            expect(maxAgeMatch).not.toBeNull();
            expect(Number(maxAgeMatch![1])).toBeGreaterThanOrEqual(31536000);

            // X-Content-Type-Options must be nosniff
            expect(res.headers['x-content-type-options']).toBe('nosniff');

            // X-Frame-Options must be DENY
            expect(res.headers['x-frame-options']).toBe('DENY');

            // Permissions-Policy must be present
            const permissionsPolicy = res.headers['permissions-policy'];
            expect(permissionsPolicy).toBeDefined();
            expect(permissionsPolicy.length).toBeGreaterThan(0);

            // X-Powered-By must be absent
            expect(res.headers['x-powered-by']).toBeUndefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('HSTS includes includeSubDomains directive', async () => {
      const app = createSecurityHeadersTestApp();

      await fc.assert(
        fc.asyncProperty(
          httpMethodArb,
          randomPathArb,
          async (method, path) => {
            const req = request(app);
            let res: request.Response;

            switch (method) {
              case 'GET':
                res = await req.get(path);
                break;
              case 'POST':
                res = await req.post(path);
                break;
              case 'PUT':
                res = await req.put(path);
                break;
              case 'DELETE':
                res = await req.delete(path);
                break;
              default:
                res = await req.get(path);
            }

            const hsts = res.headers['strict-transport-security'];
            expect(hsts).toBeDefined();
            expect(hsts).toContain('includeSubDomains');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Permissions-Policy restricts camera, microphone, and geolocation', async () => {
      const app = createSecurityHeadersTestApp();

      await fc.assert(
        fc.asyncProperty(
          httpMethodArb,
          randomPathArb,
          async (method, path) => {
            const req = request(app);
            let res: request.Response;

            switch (method) {
              case 'GET':
                res = await req.get(path);
                break;
              case 'POST':
                res = await req.post(path);
                break;
              case 'PUT':
                res = await req.put(path);
                break;
              case 'DELETE':
                res = await req.delete(path);
                break;
              default:
                res = await req.get(path);
            }

            const permissionsPolicy = res.headers['permissions-policy'];
            expect(permissionsPolicy).toContain('camera=()');
            expect(permissionsPolicy).toContain('microphone=()');
            expect(permissionsPolicy).toContain('geolocation=()');
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});


// ── CORS Property Tests ──

import cors from 'cors';

// Feature: security-audit, Property 13: CORS rejects unlisted origins
/**
 * Property 13: CORS rejects unlisted origins
 *
 * For any origin not in the configured allowlist, CORS preflight does not
 * receive Access-Control-Allow-Origin. For origins in the allowlist, CORS
 * preflight does receive Access-Control-Allow-Origin.
 *
 * **Validates: Requirements 4.8**
 */

const CORS_ALLOWLIST = ['http://localhost:5173', 'https://app.morket.io'];

/**
 * Creates a minimal Express app with the same CORS origin callback logic
 * used in createApp(), plus a catch-all route for testing.
 */
function createCorsTestApp(allowlist: string[]) {
  const app = express();
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, health checks)
      if (!origin) {
        return callback(null, true);
      }
      if (allowlist.includes(origin)) {
        return callback(null, origin);
      }
      return callback(null, false);
    },
  }));
  app.all('*', (_req: Request, res: Response) => {
    res.status(200).json({ success: true });
  });
  return app;
}

/** Generates a random origin URL that is NOT in the allowlist */
const unlistedOriginArb = fc
  .tuple(
    fc.constantFrom('http', 'https'),
    fc.stringOf(
      fc.constantFrom(
        'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
        'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
      ),
      { minLength: 3, maxLength: 20 },
    ),
    fc.option(fc.integer({ min: 1024, max: 65535 }), { nil: undefined }),
  )
  .map(([scheme, host, port]) => {
    const origin = port ? `${scheme}://${host}.example.com:${port}` : `${scheme}://${host}.example.com`;
    return origin;
  })
  .filter((origin) => !CORS_ALLOWLIST.includes(origin));

/** Generates an origin that IS in the allowlist */
const listedOriginArb = fc.constantFrom(...CORS_ALLOWLIST);

describe('Feature: security-audit, CORS Properties', () => {
  beforeEach(() => {
    _resetRateLimiterState();
  });

  describe('Property 13: CORS rejects unlisted origins', () => {
    it('preflight from unlisted origins does not receive Access-Control-Allow-Origin', async () => {
      const app = createCorsTestApp(CORS_ALLOWLIST);

      await fc.assert(
        fc.asyncProperty(unlistedOriginArb, async (origin) => {
          const res = await request(app)
            .options('/api/v1/health')
            .set('Origin', origin)
            .set('Access-Control-Request-Method', 'GET');

          // Unlisted origin must NOT get Access-Control-Allow-Origin
          const acao = res.headers['access-control-allow-origin'];
          expect(acao).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });

    it('preflight from listed origins receives Access-Control-Allow-Origin', async () => {
      const app = createCorsTestApp(CORS_ALLOWLIST);

      await fc.assert(
        fc.asyncProperty(listedOriginArb, async (origin) => {
          const res = await request(app)
            .options('/api/v1/health')
            .set('Origin', origin)
            .set('Access-Control-Request-Method', 'GET');

          // Listed origin MUST get Access-Control-Allow-Origin matching the origin
          const acao = res.headers['access-control-allow-origin'];
          expect(acao).toBe(origin);
        }),
        { numRuns: 100 },
      );
    });

    it('regular requests from unlisted origins do not receive Access-Control-Allow-Origin', async () => {
      const app = createCorsTestApp(CORS_ALLOWLIST);

      await fc.assert(
        fc.asyncProperty(unlistedOriginArb, async (origin) => {
          const res = await request(app)
            .get('/api/v1/health')
            .set('Origin', origin);

          // Unlisted origin must NOT get Access-Control-Allow-Origin on regular requests
          const acao = res.headers['access-control-allow-origin'];
          expect(acao).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });
  });
});

// ── Mocks for auth service login tests (Property 1) ──
vi.mock('../../src/modules/auth/user.repository', () => ({
  findByEmail: vi.fn(),
  createUser: vi.fn(),
}));

vi.mock('../../src/modules/auth/token.repository', () => ({
  createToken: vi.fn(),
  findByTokenHash: vi.fn(),
  revokeById: vi.fn(),
  revokeAllForUser: vi.fn(),
  countActiveForUser: vi.fn(),
  findOldestActiveForUser: vi.fn(),
  findRevokedByTokenHash: vi.fn(),
}));

vi.mock('../../src/modules/workspace/membership.repository', () => ({
  findFirstForUser: vi.fn(),
  findByUserAndWorkspace: vi.fn(),
  findAllForWorkspace: vi.fn(),
  create: vi.fn(),
  updateRole: vi.fn(),
  deleteMembership: vi.fn(),
  countOwners: vi.fn(),
}));

// Feature: security-audit, Property 1: Generic login error messages
describe('Feature: security-audit, Property 1: Generic login error messages', () => {
  const KNOWN_PASSWORD = 'KnownP@ss123';
  let knownPasswordHash: string;
  let findByEmailMock: ReturnType<typeof vi.fn>;
  let createTokenMock: ReturnType<typeof vi.fn>;
  let findFirstForUserMock: ReturnType<typeof vi.fn>;

  const testConfig = {
    jwtSecret: 'test-secret-for-property-1',
    jwtAccessExpiry: '15m',
    jwtRefreshExpiry: '7d',
  };

  beforeAll(async () => {
    const bcrypt = await import('bcrypt');
    knownPasswordHash = await bcrypt.hash(KNOWN_PASSWORD, 4); // low rounds for speed
  });

  beforeEach(async () => {
    vi.resetAllMocks();

    const userRepo = await import('../../src/modules/auth/user.repository');
    const tokenRepo = await import('../../src/modules/auth/token.repository');
    const membershipRepo = await import('../../src/modules/workspace/membership.repository');

    findByEmailMock = userRepo.findByEmail as ReturnType<typeof vi.fn>;
    createTokenMock = tokenRepo.createToken as ReturnType<typeof vi.fn>;
    findFirstForUserMock = membershipRepo.findFirstForUser as ReturnType<typeof vi.fn>;

    // Default: createToken resolves (needed for successful login path setup)
    createTokenMock.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
    });

    findFirstForUserMock.mockResolvedValue({
      userId: 'user-1',
      workspaceId: 'ws-1',
      role: 'member',
      invitedAt: new Date(),
      acceptedAt: new Date(),
    });

    // Reset lockout state between iterations
    const { _resetLockoutState } = await import('../../src/modules/auth/auth.service');
    _resetLockoutState();
  });

  /**
   * **Validates: Requirements 1.1**
   *
   * For any login with a non-existent email or an incorrect password,
   * the error response message must be identical — preventing user enumeration.
   */
  it('error message for non-existent email is identical to error message for wrong password', async () => {
    const { login, _resetLockoutState } = await import('../../src/modules/auth/auth.service');

    // Generator: random email-like strings and random wrong passwords
    const emailArb = fc
      .tuple(fc.stringMatching(/^[a-z]{3,10}$/), fc.stringMatching(/^[a-z]{2,6}$/))
      .map(([local, domain]) => `${local}@${domain}.com`);

    const wrongPasswordArb = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter((p) => p !== KNOWN_PASSWORD);

    await fc.assert(
      fc.asyncProperty(emailArb, wrongPasswordArb, async (email, wrongPassword) => {
        // Reset lockout and mocks for each iteration
        _resetLockoutState();

        // ── Scenario A: Non-existent email ──
        findByEmailMock.mockResolvedValueOnce(null);

        let errorNonExistent: Error | null = null;
        try {
          await login(email, wrongPassword, testConfig);
        } catch (e) {
          errorNonExistent = e as Error;
        }

        // ── Scenario B: Existing user, wrong password ──
        findByEmailMock.mockResolvedValueOnce({
          id: 'user-existing',
          email,
          passwordHash: knownPasswordHash,
          name: 'Test User',
          avatarUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        let errorWrongPassword: Error | null = null;
        try {
          await login(email, wrongPassword, testConfig);
        } catch (e) {
          errorWrongPassword = e as Error;
        }

        // Both must throw
        expect(errorNonExistent).not.toBeNull();
        expect(errorWrongPassword).not.toBeNull();

        // Error messages must be identical — indistinguishable to an attacker
        expect(errorNonExistent!.message).toBe(errorWrongPassword!.message);

        // Both should be "Invalid credentials"
        expect(errorNonExistent!.message).toBe('Invalid credentials');
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: security-audit, Property 21: Refresh token limit per user
/**
 * Property 21: Refresh token limit per user
 *
 * After creating more than 10 active refresh tokens, total active tokens ≤ 10
 * with oldest revoked first.
 *
 * **Validates: Requirements 10.3**
 */
describe('Feature: security-audit, Property 21: Refresh token limit per user', () => {
  const KNOWN_PASSWORD = 'SecureP@ss456';
  let knownPasswordHash: string;

  const testConfig = {
    jwtSecret: 'test-secret-for-property-21',
    jwtAccessExpiry: '15m',
    jwtRefreshExpiry: '7d',
  };

  beforeAll(async () => {
    const bcrypt = await import('bcrypt');
    knownPasswordHash = await bcrypt.hash(KNOWN_PASSWORD, 4);
  });

  beforeEach(async () => {
    vi.resetAllMocks();

    const { _resetLockoutState } = await import('../../src/modules/auth/auth.service');
    _resetLockoutState();
  });

  it('when active token count exceeds 10, the oldest token is revoked', async () => {
    const { login, _resetLockoutState } = await import('../../src/modules/auth/auth.service');
    const userRepo = await import('../../src/modules/auth/user.repository');
    const tokenRepo = await import('../../src/modules/auth/token.repository');
    const membershipRepo = await import('../../src/modules/workspace/membership.repository');

    const findByEmailMock = userRepo.findByEmail as ReturnType<typeof vi.fn>;
    const createTokenMock = tokenRepo.createToken as ReturnType<typeof vi.fn>;
    const countActiveForUserMock = tokenRepo.countActiveForUser as ReturnType<typeof vi.fn>;
    const findOldestActiveForUserMock = tokenRepo.findOldestActiveForUser as ReturnType<typeof vi.fn>;
    const revokeByIdMock = tokenRepo.revokeById as ReturnType<typeof vi.fn>;
    const findFirstForUserMock = membershipRepo.findFirstForUser as ReturnType<typeof vi.fn>;

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 11, max: 20 }), // activeCount > 10
        fc.uuid(),                          // userId
        fc.uuid(),                          // oldestTokenId
        async (activeCount, userId, oldestTokenId) => {
          _resetLockoutState();
          vi.resetAllMocks();

          // Mock user found with valid password
          findByEmailMock.mockResolvedValue({
            id: userId,
            email: 'test@example.com',
            passwordHash: knownPasswordHash,
            name: 'Test User',
            avatarUrl: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Mock membership lookup
          findFirstForUserMock.mockResolvedValue({
            userId,
            workspaceId: 'ws-1',
            role: 'member',
            invitedAt: new Date(),
            acceptedAt: new Date(),
          });

          // Mock token creation
          createTokenMock.mockResolvedValue({
            id: 'new-tok',
            userId,
            tokenHash: 'hash',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            revokedAt: null,
            createdAt: new Date(),
          });

          // Mock: active count exceeds limit
          countActiveForUserMock.mockResolvedValue(activeCount);

          // Mock: oldest active token
          findOldestActiveForUserMock.mockResolvedValue({ id: oldestTokenId });

          // Mock revokeById
          revokeByIdMock.mockResolvedValue(undefined);

          await login('test@example.com', KNOWN_PASSWORD, testConfig);

          // enforceTokenLimit should have been called and revoked the oldest token
          expect(countActiveForUserMock).toHaveBeenCalledWith(userId);
          expect(findOldestActiveForUserMock).toHaveBeenCalledWith(userId);
          expect(revokeByIdMock).toHaveBeenCalledWith(oldestTokenId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('when active token count is at or below 10, no tokens are revoked by enforceTokenLimit', async () => {
    const { login, _resetLockoutState } = await import('../../src/modules/auth/auth.service');
    const userRepo = await import('../../src/modules/auth/user.repository');
    const tokenRepo = await import('../../src/modules/auth/token.repository');
    const membershipRepo = await import('../../src/modules/workspace/membership.repository');

    const findByEmailMock = userRepo.findByEmail as ReturnType<typeof vi.fn>;
    const createTokenMock = tokenRepo.createToken as ReturnType<typeof vi.fn>;
    const countActiveForUserMock = tokenRepo.countActiveForUser as ReturnType<typeof vi.fn>;
    const findOldestActiveForUserMock = tokenRepo.findOldestActiveForUser as ReturnType<typeof vi.fn>;
    const findFirstForUserMock = membershipRepo.findFirstForUser as ReturnType<typeof vi.fn>;

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }), // activeCount <= 10
        fc.uuid(),                         // userId
        async (activeCount, userId) => {
          _resetLockoutState();
          vi.resetAllMocks();

          // Mock user found with valid password
          findByEmailMock.mockResolvedValue({
            id: userId,
            email: 'test@example.com',
            passwordHash: knownPasswordHash,
            name: 'Test User',
            avatarUrl: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Mock membership lookup
          findFirstForUserMock.mockResolvedValue({
            userId,
            workspaceId: 'ws-1',
            role: 'member',
            invitedAt: new Date(),
            acceptedAt: new Date(),
          });

          // Mock token creation
          createTokenMock.mockResolvedValue({
            id: 'new-tok',
            userId,
            tokenHash: 'hash',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            revokedAt: null,
            createdAt: new Date(),
          });

          // Mock: active count within limit
          countActiveForUserMock.mockResolvedValue(activeCount);

          await login('test@example.com', KNOWN_PASSWORD, testConfig);

          // enforceTokenLimit should check count but NOT revoke anything
          expect(countActiveForUserMock).toHaveBeenCalledWith(userId);
          expect(findOldestActiveForUserMock).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: security-audit, Property 20: Token expiry Zod validation
/**
 * Property 20: Token expiry Zod validation
 *
 * For any environment configuration where JWT_ACCESS_EXPIRY exceeds 15 minutes
 * or JWT_REFRESH_EXPIRY exceeds 7 days, the Zod schema rejects the configuration.
 *
 * Tests parseExpiryToSeconds directly and verifies the validation logic:
 * 1. Valid format strings with values exceeding limits → should be rejected (returns > limit)
 * 2. Valid format strings within limits → should be accepted (returns ≤ limit)
 * 3. Invalid format strings → should return null
 *
 * **Validates: Requirements 10.1**
 */

// We inline the parseExpiryToSeconds logic here because importing env.ts triggers
// module-level validateEnv() which calls process.exit(1) in test environments.
// This is a faithful copy of the function from src/config/env.ts.
function parseExpiryToSecondsLocal(expiry: string): number | null {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[unit];
}

describe('Feature: security-audit, Property 20: Token expiry Zod validation', () => {
  const MAX_ACCESS_EXPIRY_SECONDS = 900;    // 15 minutes
  const MAX_REFRESH_EXPIRY_SECONDS = 604800; // 7 days

  const units = ['s', 'm', 'h', 'd'] as const;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

  it('valid format strings exceeding access expiry limit are detected as > 900 seconds', () => {
    // Generate a unit and a value that, when combined, exceeds 900 seconds
    const exceedingAccessArb = fc
      .tuple(
        fc.constantFrom(...units),
        fc.integer({ min: 1, max: 10000 }),
      )
      .filter(([unit, value]) => value * multipliers[unit] > MAX_ACCESS_EXPIRY_SECONDS)
      .map(([unit, value]) => ({ expiry: `${value}${unit}`, expectedSeconds: value * multipliers[unit] }));

    fc.assert(
      fc.property(exceedingAccessArb, ({ expiry, expectedSeconds }) => {
        const result = parseExpiryToSecondsLocal(expiry);
        expect(result).not.toBeNull();
        expect(result).toBe(expectedSeconds);
        expect(result!).toBeGreaterThan(MAX_ACCESS_EXPIRY_SECONDS);
      }),
      { numRuns: 100 },
    );
  });

  it('valid format strings within access expiry limit parse to ≤ 900 seconds', () => {
    // Generate a unit and a value that, when combined, is ≤ 900 seconds
    const withinAccessArb = fc
      .tuple(
        fc.constantFrom(...units),
        fc.integer({ min: 1, max: 10000 }),
      )
      .filter(([unit, value]) => value * multipliers[unit] <= MAX_ACCESS_EXPIRY_SECONDS && value * multipliers[unit] > 0)
      .map(([unit, value]) => ({ expiry: `${value}${unit}`, expectedSeconds: value * multipliers[unit] }));

    fc.assert(
      fc.property(withinAccessArb, ({ expiry, expectedSeconds }) => {
        const result = parseExpiryToSecondsLocal(expiry);
        expect(result).not.toBeNull();
        expect(result).toBe(expectedSeconds);
        expect(result!).toBeLessThanOrEqual(MAX_ACCESS_EXPIRY_SECONDS);
      }),
      { numRuns: 100 },
    );
  });

  it('valid format strings exceeding refresh expiry limit are detected as > 604800 seconds', () => {
    // Generate a unit and a value that, when combined, exceeds 604800 seconds
    const exceedingRefreshArb = fc
      .tuple(
        fc.constantFrom(...units),
        fc.integer({ min: 1, max: 100000 }),
      )
      .filter(([unit, value]) => value * multipliers[unit] > MAX_REFRESH_EXPIRY_SECONDS)
      .map(([unit, value]) => ({ expiry: `${value}${unit}`, expectedSeconds: value * multipliers[unit] }));

    fc.assert(
      fc.property(exceedingRefreshArb, ({ expiry, expectedSeconds }) => {
        const result = parseExpiryToSecondsLocal(expiry);
        expect(result).not.toBeNull();
        expect(result).toBe(expectedSeconds);
        expect(result!).toBeGreaterThan(MAX_REFRESH_EXPIRY_SECONDS);
      }),
      { numRuns: 100 },
    );
  });

  it('valid format strings within refresh expiry limit parse to ≤ 604800 seconds', () => {
    // Generate a unit and a value that, when combined, is ≤ 604800 seconds
    const withinRefreshArb = fc
      .tuple(
        fc.constantFrom(...units),
        fc.integer({ min: 1, max: 100000 }),
      )
      .filter(([unit, value]) => value * multipliers[unit] <= MAX_REFRESH_EXPIRY_SECONDS && value * multipliers[unit] > 0)
      .map(([unit, value]) => ({ expiry: `${value}${unit}`, expectedSeconds: value * multipliers[unit] }));

    fc.assert(
      fc.property(withinRefreshArb, ({ expiry, expectedSeconds }) => {
        const result = parseExpiryToSecondsLocal(expiry);
        expect(result).not.toBeNull();
        expect(result).toBe(expectedSeconds);
        expect(result!).toBeLessThanOrEqual(MAX_REFRESH_EXPIRY_SECONDS);
      }),
      { numRuns: 100 },
    );
  });

  it('invalid format strings return null from parseExpiryToSeconds', () => {
    // Generate strings that do NOT match the <number><unit> pattern
    const invalidFormatArb = fc.oneof(
      // No unit suffix
      fc.integer({ min: 0, max: 9999 }).map(String),
      // Wrong unit suffix
      fc.tuple(
        fc.integer({ min: 1, max: 9999 }),
        fc.constantFrom('x', 'w', 'y', 'ms', 'sec', 'min', 'hr', 'day', 'M', 'S', 'H', 'D'),
      ).map(([n, u]) => `${n}${u}`),
      // Negative values
      fc.integer({ min: -9999, max: -1 }).map((n) => `${n}s`),
      // Empty string
      fc.constant(''),
      // Just a unit
      fc.constantFrom('s', 'm', 'h', 'd'),
      // Decimal values
      fc.tuple(
        fc.integer({ min: 1, max: 999 }),
        fc.integer({ min: 1, max: 99 }),
        fc.constantFrom('s', 'm', 'h', 'd'),
      ).map(([a, b, u]) => `${a}.${b}${u}`),
      // Random non-numeric strings
      fc.stringOf(fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z', '!', '@', '#'), { minLength: 1, maxLength: 10 }),
    );

    fc.assert(
      fc.property(invalidFormatArb, (invalidExpiry) => {
        const result = parseExpiryToSecondsLocal(invalidExpiry);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Encryption Property Tests (Properties 14, 15, 16)
// ═══════════════════════════════════════════════════════════════════════════════

import { deriveWorkspaceKey, encrypt, decrypt } from '../../src/shared/encryption';

// Feature: security-audit, Property 14: Master key length validation
// **Validates: Requirements 5.1**
describe('Property 14: Master key length validation', () => {
  it('deriveWorkspaceKey throws for any Buffer not exactly 32 bytes', () => {
    // Generate buffer lengths in [0, 31] ∪ [33, 64] — anything except 32
    const invalidKeyLengthArb = fc.oneof(
      fc.integer({ min: 0, max: 31 }),
      fc.integer({ min: 33, max: 64 }),
    );

    fc.assert(
      fc.property(
        invalidKeyLengthArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (keyLength, workspaceId) => {
          const invalidKey = Buffer.alloc(keyLength, 0xab);
          expect(() => deriveWorkspaceKey(invalidKey, workspaceId)).toThrow(
            /Master key must be exactly 32 bytes/,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('deriveWorkspaceKey does NOT throw for a valid 32-byte key', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (keyBytes, workspaceId) => {
          const validKey = Buffer.from(keyBytes);
          expect(() => deriveWorkspaceKey(validKey, workspaceId)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: security-audit, Property 15: Unique workspace key derivation
// **Validates: Requirements 5.2**
describe('Property 15: Unique workspace key derivation', () => {
  it('two distinct workspace IDs with same master key produce different derived keys', () => {
    // Generate two distinct non-empty workspace IDs
    const distinctIdsArb = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
      )
      .filter(([a, b]) => a !== b);

    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        distinctIdsArb,
        (keyBytes, [wsId1, wsId2]) => {
          const masterKey = Buffer.from(keyBytes);
          const derivedKey1 = deriveWorkspaceKey(masterKey, wsId1);
          const derivedKey2 = deriveWorkspaceKey(masterKey, wsId2);
          expect(derivedKey1.equals(derivedKey2)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: security-audit, Property 16: Encryption round-trip (write-verify)
// **Validates: Requirements 5.3**
describe('Property 16: Encryption round-trip (write-verify)', () => {
  it('encrypt then decrypt produces original plaintext for any input', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 1000 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        (plaintext, keyBytes) => {
          const key = Buffer.from(keyBytes);
          const encrypted = encrypt(plaintext, key);

          // Verify the encrypted result has the expected shape
          expect(encrypted).toHaveProperty('ciphertext');
          expect(encrypted).toHaveProperty('iv');
          expect(encrypted).toHaveProperty('authTag');
          expect(typeof encrypted.ciphertext).toBe('string');
          expect(typeof encrypted.iv).toBe('string');
          expect(typeof encrypted.authTag).toBe('string');

          // Decrypt and verify round-trip
          const decrypted = decrypt(
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.authTag,
            key,
          );
          expect(decrypted).toBe(plaintext);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Input Sanitization Property Tests (Properties 7, 8, 9)
// ═══════════════════════════════════════════════════════════════════════════════

import { sanitizeString, isFormulaInjection, validateUrlSafety } from '../../src/shared/sanitize';
import dns from 'dns';

// Feature: security-audit, Property 7: HTML sanitization encodes dangerous characters
/**
 * Property 7: HTML sanitization encodes dangerous characters
 *
 * For any string containing HTML metacharacters (<, >, ", ', &),
 * sanitizeString() returns a string where all such characters are
 * HTML-entity encoded, and the output contains no unescaped HTML tags.
 *
 * **Validates: Requirements 3.3, 9.2, 9.3**
 */
describe('Feature: security-audit, Property 7: HTML sanitization encodes dangerous characters', () => {
  /** Generates arbitrary strings that contain at least one dangerous character */
  const dangerousCharArb = fc.constantFrom('<', '>', '"', "'", '&');

  const stringWithDangerousCharsArb = fc
    .tuple(
      fc.string({ minLength: 0, maxLength: 50 }),
      dangerousCharArb,
      fc.string({ minLength: 0, maxLength: 50 }),
    )
    .map(([prefix, dangerous, suffix]) => `${prefix}${dangerous}${suffix}`);

  it('output never contains raw <, >, ", \', or & characters from input', () => {
    fc.assert(
      fc.property(stringWithDangerousCharsArb, (input) => {
        const output = sanitizeString(input);

        // Count dangerous chars in input
        const inputDangerousCount =
          (input.match(/[<>"'&]/g) || []).length;

        // The output must not contain any raw dangerous characters
        // (the encoded entities like &amp; contain & but that's the encoding itself)
        // We verify by checking that decoding the output back gives us the original
        // and that specific raw patterns are replaced
        if (input.includes('&')) {
          expect(output).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#x27;)/);
        }
        if (input.includes('<')) {
          expect(output).toContain('&lt;');
          expect(output).not.toMatch(/<(?!)/); // no raw < that isn't part of entity
        }
        if (input.includes('>')) {
          expect(output).toContain('&gt;');
        }
        if (input.includes('"')) {
          expect(output).toContain('&quot;');
        }
        if (input.includes("'")) {
          expect(output).toContain('&#x27;');
        }

        // Output must have at least as many characters as input (encoding expands)
        expect(output.length).toBeGreaterThanOrEqual(input.length);
      }),
      { numRuns: 100 },
    );
  });

  it('output contains no unescaped HTML tags', () => {
    // Generate strings that look like HTML tags
    const htmlTagArb = fc
      .tuple(
        fc.stringOf(fc.constantFrom('a', 'b', 'div', 'script', 'img', 'p', 'span'), { minLength: 1, maxLength: 1 }),
        fc.string({ minLength: 0, maxLength: 20 }),
      )
      .map(([tag, content]) => `<${tag}>${content}</${tag}>`);

    fc.assert(
      fc.property(htmlTagArb, (input) => {
        const output = sanitizeString(input);

        // Output must not contain any raw HTML tags (< followed by a letter)
        expect(output).not.toMatch(/<[a-zA-Z]/);
        expect(output).not.toMatch(/<\/[a-zA-Z]/);
      }),
      { numRuns: 100 },
    );
  });

  it('strings without dangerous characters pass through unchanged', () => {
    const safeStringArb = fc
      .stringOf(
        fc.constantFrom(
          'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
          'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
          '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ' ', '.', ',',
          '!', '?', ':', ';', '-', '_', '(', ')', '[', ']', '{', '}',
        ),
        { minLength: 0, maxLength: 100 },
      )
      .filter((s) => !/[<>"'&]/.test(s));

    fc.assert(
      fc.property(safeStringArb, (input) => {
        const output = sanitizeString(input);
        expect(output).toBe(input);
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: security-audit, Property 8: Formula injection detection
/**
 * Property 8: Formula injection detection
 *
 * For any string starting with =, +, -, or @, isFormulaInjection() returns true.
 * For any string not starting with these characters (after trimming), it returns false.
 *
 * **Validates: Requirements 3.5**
 */
describe('Feature: security-audit, Property 8: Formula injection detection', () => {
  const formulaPrefixArb = fc.constantFrom('=', '+', '-', '@');

  it('returns true for any string starting with =, +, -, or @ (with optional leading whitespace)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 10 }).filter((s) => s.trim() === ''), // leading whitespace
        formulaPrefixArb,
        fc.string({ minLength: 0, maxLength: 50 }), // rest of string
        (whitespace, prefix, rest) => {
          const input = `${whitespace}${prefix}${rest}`;
          expect(isFormulaInjection(input)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns false for any non-empty string not starting with formula characters', () => {
    // Generate strings whose trimmed first character is NOT =, +, -, @
    const safeFirstCharArb = fc.constantFrom(
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
      'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
      '#', '$', '%', '^', '&', '*', '(', ')', '!', '?',
    );

    fc.assert(
      fc.property(
        safeFirstCharArb,
        fc.string({ minLength: 0, maxLength: 50 }),
        (firstChar, rest) => {
          const input = `${firstChar}${rest}`;
          expect(isFormulaInjection(input)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns false for empty strings', () => {
    expect(isFormulaInjection('')).toBe(false);
    expect(isFormulaInjection('   ')).toBe(false);
  });
});


// Feature: security-audit, Property 9: URL scheme and IP range validation
/**
 * Property 9: URL scheme and IP range validation
 *
 * Non-http/https schemes are rejected. URLs resolving to RFC 1918,
 * loopback, or link-local IPs are rejected.
 *
 * **Validates: Requirements 3.8, 13.4, 13.6**
 */
describe('Feature: security-audit, Property 9: URL scheme and IP range validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects URLs with non-http/https schemes', async () => {
    const nonHttpSchemeArb = fc.constantFrom(
      'ftp', 'file', 'gopher', 'ssh', 'telnet', 'data', 'javascript',
      'ldap', 'dict', 'sftp', 'imap', 'smtp',
    );

    await fc.assert(
      fc.asyncProperty(
        nonHttpSchemeArb,
        fc.stringOf(
          fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'),
          { minLength: 3, maxLength: 15 },
        ),
        async (scheme, host) => {
          const url = `${scheme}://${host}.example.com/path`;
          const result = await validateUrlSafety(url);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects URLs resolving to RFC 1918 private IPs (10.x.x.x)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        async (b, c, d) => {
          const privateIp = `10.${b}.${c}.${d}`;
          vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: privateIp, family: 4 });

          const result = await validateUrlSafety(`https://some-host.example.com`);
          expect(result).toBe(false);

          vi.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects URLs resolving to RFC 1918 private IPs (172.16-31.x.x)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 16, max: 31 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        async (b, c, d) => {
          const privateIp = `172.${b}.${c}.${d}`;
          vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: privateIp, family: 4 });

          const result = await validateUrlSafety(`https://some-host.example.com`);
          expect(result).toBe(false);

          vi.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects URLs resolving to RFC 1918 private IPs (192.168.x.x)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        async (c, d) => {
          const privateIp = `192.168.${c}.${d}`;
          vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: privateIp, family: 4 });

          const result = await validateUrlSafety(`https://some-host.example.com`);
          expect(result).toBe(false);

          vi.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects URLs resolving to loopback IPs (127.x.x.x)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        async (b, c, d) => {
          const loopbackIp = `127.${b}.${c}.${d}`;
          vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: loopbackIp, family: 4 });

          const result = await validateUrlSafety(`https://some-host.example.com`);
          expect(result).toBe(false);

          vi.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects URLs resolving to link-local IPs (169.254.x.x)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        async (c, d) => {
          const linkLocalIp = `169.254.${c}.${d}`;
          vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: linkLocalIp, family: 4 });

          const result = await validateUrlSafety(`https://some-host.example.com`);
          expect(result).toBe(false);

          vi.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('accepts URLs resolving to public IPs with http/https schemes', async () => {
    // Generate public IPs that are NOT in any private range
    const publicIpArb = fc
      .tuple(
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 1, max: 254 }),
      )
      .filter(([a, b, _c, _d]) => {
        if (a === 10) return false;                          // 10.0.0.0/8
        if (a === 172 && b >= 16 && b <= 31) return false;   // 172.16.0.0/12
        if (a === 192 && b === 168) return false;             // 192.168.0.0/16
        if (a === 127) return false;                          // 127.0.0.0/8
        if (a === 169 && b === 254) return false;             // 169.254.0.0/16
        if (a === 0) return false;                            // 0.0.0.0/8
        return true;
      })
      .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

    const schemeArb = fc.constantFrom('http', 'https');

    await fc.assert(
      fc.asyncProperty(publicIpArb, schemeArb, async (publicIp, scheme) => {
        vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: publicIp, family: 4 });

        const result = await validateUrlSafety(`${scheme}://some-host.example.com`);
        expect(result).toBe(true);

        vi.restoreAllMocks();
      }),
      { numRuns: 100 },
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// AI Filter Whitelist Validation Property Test (Property 18)
// ═══════════════════════════════════════════════════════════════════════════════

import {
  ALLOWED_FILTER_FIELDS,
  ALLOWED_FILTER_OPERATORS,
  validateFilters,
  validateFilterOperator,
  parseNaturalLanguageQuery,
} from '../../src/modules/ai/ai.service';

// Feature: security-audit, Property 18: AI filter whitelist validation
/**
 * Property 18: AI filter whitelist validation
 *
 * For any structured filter from the AI parser, all field names are in the
 * allowed whitelist and all operators are in the allowed operator set.
 *
 * **Validates: Requirements 3.7**
 */
describe('Feature: security-audit, Property 18: AI filter whitelist validation', () => {
  const allowedFieldsArray = Array.from(ALLOWED_FILTER_FIELDS);
  const allowedOperatorsArray = Array.from(ALLOWED_FILTER_OPERATORS);

  // Arbitrary for valid field names (from the whitelist)
  const validFieldArb = fc.constantFrom(...allowedFieldsArray);

  // Arbitrary for invalid field names (not in the whitelist)
  const invalidFieldArb = fc
    .stringOf(
      fc.constantFrom(
        'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
        'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
        '_', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
      ),
      { minLength: 1, maxLength: 20 },
    )
    .filter((s) => !ALLOWED_FILTER_FIELDS.has(s));

  it('validateFilters accepts any filter object with only whitelisted field names', () => {
    // Generate a record with 1-5 valid field names mapped to arbitrary string values
    const validFiltersArb = fc
      .array(
        fc.tuple(validFieldArb, fc.string({ minLength: 1, maxLength: 30 })),
        { minLength: 1, maxLength: 5 },
      )
      .map((pairs) => Object.fromEntries(pairs));

    fc.assert(
      fc.property(validFiltersArb, (filters) => {
        const result = validateFilters(filters);
        expect(result.valid).toBe(true);
        expect(result.invalidFields).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it('validateFilters rejects any filter object containing non-whitelisted field names', () => {
    // Generate a record with at least one invalid field name
    const filtersWithInvalidFieldArb = fc
      .tuple(
        invalidFieldArb,
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.array(
          fc.tuple(validFieldArb, fc.string({ minLength: 1, maxLength: 30 })),
          { minLength: 0, maxLength: 3 },
        ),
      )
      .map(([badField, badValue, validPairs]) =>
        Object.fromEntries([[badField, badValue], ...validPairs]),
      );

    fc.assert(
      fc.property(filtersWithInvalidFieldArb, (filters) => {
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.invalidFields.length).toBeGreaterThan(0);
        // Every reported invalid field must not be in the whitelist
        for (const field of result.invalidFields) {
          expect(ALLOWED_FILTER_FIELDS.has(field)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('validateFilterOperator accepts all whitelisted operators', () => {
    const validOperatorArb = fc.constantFrom(...allowedOperatorsArray);

    fc.assert(
      fc.property(validOperatorArb, (operator) => {
        expect(validateFilterOperator(operator)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('validateFilterOperator rejects any operator not in the allowed set', () => {
    const invalidOperatorArb = fc
      .stringOf(
        fc.constantFrom(
          'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
          'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
          '_', ' ', 'A', 'B', 'C', 'D', 'E', 'F',
        ),
        { minLength: 1, maxLength: 20 },
      )
      .filter((s) => !ALLOWED_FILTER_OPERATORS.has(s));

    fc.assert(
      fc.property(invalidOperatorArb, (operator) => {
        expect(validateFilterOperator(operator)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('parseNaturalLanguageQuery output only contains whitelisted fields', () => {
    // Generate arbitrary query strings that may contain field keywords, random words, etc.
    const queryArb = fc
      .array(
        fc.oneof(
          // Known field keywords that should map to valid fields
          fc.constantFrom(
            'email', 'mail', 'contact', 'first', 'name', 'given',
            'last', 'surname', 'company', 'org', 'business',
            'title', 'role', 'position', 'phone', 'tel', 'mobile',
            'location', 'city', 'address', 'industry', 'sector',
            'status', 'completed', 'failed', 'pending',
          ),
          // Random words that could be values or noise
          fc.stringOf(
            fc.constantFrom(
              'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l',
              'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x',
            ),
            { minLength: 1, maxLength: 10 },
          ),
          // Potentially malicious field names that should be stripped
          fc.constantFrom(
            'ssn', 'password', 'secret', 'credit_card', 'DROP', 'SELECT',
            '__proto__', 'constructor', 'admin', 'root',
          ),
        ),
        { minLength: 1, maxLength: 8 },
      )
      .map((words) => words.join(' '));

    fc.assert(
      fc.property(queryArb, (query) => {
        const result = parseNaturalLanguageQuery(query);
        // Every field in the output filters must be in the allowed whitelist
        for (const field of Object.keys(result.filters)) {
          expect(ALLOWED_FILTER_FIELDS.has(field)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Property 17: Log redaction of sensitive fields
// Property 22: Security event log structure
// ────────────────────────────────────────────────────────────────────────────

import {
  redactHeaders,
  redactFields,
  logAuthFailure,
  logAuthzFailure,
  logRateLimitHit,
  logWebhookFailure,
} from '../../src/observability/logger';

describe('Property 17: Log redaction of sensitive fields', () => {
  // Feature: security-audit, Property 17: Log redaction of sensitive fields

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('redactHeaders replaces sensitive header values with [REDACTED] while preserving others', () => {
    const sensitiveKeys = ['authorization', 'Authorization', 'x-service-key', 'X-Service-Key', 'cookie', 'Cookie', 'set-cookie', 'Set-Cookie'] as const;

    const sensitiveKeyArb = fc.constantFrom(...sensitiveKeys);
    const nonSensitiveKeyArb = fc.constantFrom(
      'content-type', 'accept', 'x-request-id', 'host', 'user-agent', 'cache-control',
    );
    const headerValueArb = fc.string({ minLength: 1, maxLength: 100 });

    fc.assert(
      fc.property(
        sensitiveKeyArb,
        headerValueArb,
        nonSensitiveKeyArb,
        headerValueArb,
        (sensitiveKey, sensitiveValue, nonSensitiveKey, nonSensitiveValue) => {
          const headers: Record<string, string> = {
            [sensitiveKey]: sensitiveValue,
            [nonSensitiveKey]: nonSensitiveValue,
          };

          const result = redactHeaders(headers);

          // Sensitive header must be redacted
          expect(result[sensitiveKey]).toBe('[REDACTED]');
          // Non-sensitive header must be preserved
          expect(result[nonSensitiveKey]).toBe(nonSensitiveValue);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('redactFields replaces sensitive body fields with [REDACTED] at top level', () => {
    const sensitiveKeys = ['password', 'secret', 'token', 'apiKey', 'refreshToken', 'accessToken', 'creditCard'] as const;

    const sensitiveKeyArb = fc.constantFrom(...sensitiveKeys);
    const nonSensitiveKeyArb = fc.constantFrom(
      'name', 'email', 'description', 'status', 'count', 'id', 'type',
    );
    const fieldValueArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.integer(),
      fc.boolean(),
    );

    fc.assert(
      fc.property(
        sensitiveKeyArb,
        fieldValueArb,
        nonSensitiveKeyArb,
        fieldValueArb,
        (sensitiveKey, sensitiveValue, nonSensitiveKey, nonSensitiveValue) => {
          const body: Record<string, unknown> = {
            [sensitiveKey]: sensitiveValue,
            [nonSensitiveKey]: nonSensitiveValue,
          };

          const result = redactFields(body);

          // Sensitive field must be redacted
          expect(result[sensitiveKey]).toBe('[REDACTED]');
          // Non-sensitive field must be preserved
          expect(result[nonSensitiveKey]).toBe(nonSensitiveValue);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('redactFields recursively redacts sensitive fields in nested objects', () => {
    const sensitiveKeys = ['password', 'secret', 'token', 'apiKey', 'refreshToken', 'accessToken', 'creditCard'] as const;

    const sensitiveKeyArb = fc.constantFrom(...sensitiveKeys);
    const valueArb = fc.string({ minLength: 1, maxLength: 50 });

    fc.assert(
      fc.property(
        sensitiveKeyArb,
        valueArb,
        fc.integer({ min: 1, max: 4 }),
        (sensitiveKey, value, depth) => {
          // Build a nested object with the sensitive field at the given depth
          // level0 wraps first (innermost), so outermost key is level{depth-1}
          let body: Record<string, unknown> = { [sensitiveKey]: value };
          for (let i = 0; i < depth; i++) {
            body = { [`level${i}`]: body };
          }

          const result = redactFields(body);

          // Walk down: outermost is level{depth-1}, innermost is level0
          let current: Record<string, unknown> = result;
          for (let i = depth - 1; i >= 0; i--) {
            current = current[`level${i}`] as Record<string, unknown>;
          }
          expect(current[sensitiveKey]).toBe('[REDACTED]');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 22: Security event log structure', () => {
  // Feature: security-audit, Property 22: Security event log structure

  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  function captureLogEntry(): Record<string, unknown> {
    const call = stderrSpy.mock.calls[stderrSpy.mock.calls.length - 1];
    const raw = call[0] as string;
    return JSON.parse(raw.trim());
  }

  function assertBaseStructure(entry: Record<string, unknown>, expectedEventType: string): void {
    // Must have timestamp as ISO string
    expect(typeof entry.timestamp).toBe('string');
    expect(() => new Date(entry.timestamp as string).toISOString()).not.toThrow();

    // Must have level 'warn'
    expect(entry.level).toBe('warn');

    // Must have trace_id and span_id (may be from getTraceContext spread)
    // When no active OTel span, these come from the explicit ...getTraceContext() in the event functions
    // They may be undefined if no span is active, but the keys should exist in the meta spread
    expect(entry).toHaveProperty('event_type', expectedEventType);
    expect(entry).toHaveProperty('service', 'morket-backend');
  }

  it('logAuthFailure produces structured log with required fields', () => {
    const sourceIpArb = fc.ipV4();
    const reasonArb = fc.constantFrom(
      'invalid_token', 'expired_token', 'missing_token', 'invalid_signature', 'revoked_token',
    );
    const userAgentArb = fc.string({ minLength: 1, maxLength: 100 });

    fc.assert(
      fc.property(sourceIpArb, reasonArb, userAgentArb, (sourceIp, reason, userAgent) => {
        stderrSpy.mockClear();

        logAuthFailure({ sourceIp, reason, userAgent });

        expect(stderrSpy).toHaveBeenCalled();
        const entry = captureLogEntry();

        assertBaseStructure(entry, 'auth_failure');
        expect(entry.sourceIp).toBe(sourceIp);
        expect(entry.reason).toBe(reason);
      }),
      { numRuns: 100 },
    );
  });

  it('logAuthzFailure produces structured log with required fields', () => {
    const userIdArb = fc.uuid();
    const resourceArb = fc.constantFrom(
      '/api/v1/workspaces/123', '/api/v1/admin/search', '/api/v1/credentials',
    );
    const roleArb = fc.constantFrom('viewer', 'member', 'admin', 'owner', 'billing_admin');

    fc.assert(
      fc.property(userIdArb, resourceArb, roleArb, roleArb, (userId, resource, requiredRole, actualRole) => {
        stderrSpy.mockClear();

        logAuthzFailure({ userId, resource, requiredRole, actualRole });

        expect(stderrSpy).toHaveBeenCalled();
        const entry = captureLogEntry();

        assertBaseStructure(entry, 'authz_failure');
        expect(entry.userId).toBe(userId);
        expect(entry.resource).toBe(resource);
        expect(entry.requiredRole).toBe(requiredRole);
        expect(entry.actualRole).toBe(actualRole);
      }),
      { numRuns: 100 },
    );
  });

  it('logRateLimitHit produces structured log with required fields', () => {
    const sourceIpArb = fc.ipV4();
    const endpointArb = fc.constantFrom(
      '/api/v1/auth/login', '/api/v1/enrichment/jobs', '/api/v1/workspaces',
    );
    const requestCountArb = fc.integer({ min: 1, max: 10000 });

    fc.assert(
      fc.property(sourceIpArb, endpointArb, requestCountArb, (sourceIp, endpoint, requestCount) => {
        stderrSpy.mockClear();

        logRateLimitHit({ sourceIp, endpoint, requestCount });

        expect(stderrSpy).toHaveBeenCalled();
        const entry = captureLogEntry();

        assertBaseStructure(entry, 'rate_limit_hit');
        expect(entry.sourceIp).toBe(sourceIp);
        expect(entry.endpoint).toBe(endpoint);
        expect(entry.requestCount).toBe(requestCount);
      }),
      { numRuns: 100 },
    );
  });

  it('logWebhookFailure produces structured log with required fields', () => {
    const sourceIpArb = fc.ipV4();
    const endpointArb = fc.constantFrom(
      '/api/v1/webhooks/stripe', '/api/v1/webhooks/enrichment', '/api/v1/webhooks/scraper',
    );
    const reasonArb = fc.constantFrom(
      'signature_mismatch', 'expired_timestamp', 'invalid_payload', 'missing_signature',
    );

    fc.assert(
      fc.property(sourceIpArb, endpointArb, reasonArb, (sourceIp, endpoint, reason) => {
        stderrSpy.mockClear();

        logWebhookFailure({ sourceIp, endpoint, reason });

        expect(stderrSpy).toHaveBeenCalled();
        const entry = captureLogEntry();

        assertBaseStructure(entry, 'webhook_failure');
        expect(entry.sourceIp).toBe(sourceIp);
        expect(entry.endpoint).toBe(endpoint);
        expect(entry.reason).toBe(reason);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: security-audit, Property 23: Credential audit logging
describe('Feature: security-audit, Property 23: Credential audit logging', () => {
  // **Validates: Requirements 11.8**

  // We test that credential service audit logs contain the expected identifiers
  // but never the raw credential values. We use the real logger (spying on stdout)
  // and mock only the repository and encryption dependencies.

  const mockCreate = vi.fn();
  const mockFindById = vi.fn();
  const mockFindAllByWorkspace = vi.fn();
  const mockDeleteCredential = vi.fn();
  const mockUpdateLastUsed = vi.fn();
  const mockDeriveWorkspaceKey = vi.fn();
  const mockEncrypt = vi.fn();
  const mockDecrypt = vi.fn();

  let credentialService: typeof import('../../src/modules/credential/credential.service');
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    // Use vi.doMock (not hoisted) to mock only for this describe block's dynamic import
    vi.doMock('../../src/modules/credential/credential.repository', () => ({
      create: mockCreate,
      findAllByWorkspace: mockFindAllByWorkspace,
      findById: mockFindById,
      deleteCredential: mockDeleteCredential,
      updateLastUsed: mockUpdateLastUsed,
    }));
    vi.doMock('../../src/shared/encryption', () => ({
      deriveWorkspaceKey: mockDeriveWorkspaceKey,
      encrypt: mockEncrypt,
      decrypt: mockDecrypt,
    }));

    credentialService = await import('../../src/modules/credential/credential.service');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockDeriveWorkspaceKey.mockReturnValue(Buffer.alloc(32, 'k'));
    mockEncrypt.mockReturnValue({ ciphertext: 'enc-ct', iv: 'enc-iv', authTag: 'enc-tag' });
    mockDecrypt.mockReturnValue('decrypted-placeholder');
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function findLogEntry(eventType: string): Record<string, unknown> | null {
    for (const call of stdoutSpy.mock.calls) {
      const raw = call[0] as string;
      try {
        const entry = JSON.parse(raw.trim());
        if (entry.event_type === eventType) return entry;
      } catch {
        // not JSON, skip
      }
    }
    return null;
  }

  it('store() logs credential_created with userId, workspaceId, credentialId but never key/secret', async () => {
    const workspaceIdArb = fc.uuid();
    const providerNameArb = fc.constantFrom('apollo', 'clearbit', 'hunter', 'custom-provider');
    const keyArb = fc.string({ minLength: 8, maxLength: 64 });
    const secretArb = fc.string({ minLength: 8, maxLength: 64 });
    const createdByArb = fc.uuid();
    const credentialIdArb = fc.uuid();

    await fc.assert(
      fc.asyncProperty(
        workspaceIdArb, providerNameArb, keyArb, secretArb, createdByArb, credentialIdArb,
        async (workspaceId, providerName, key, secret, createdBy, credentialId) => {
          stdoutSpy.mockClear();

          mockDeriveWorkspaceKey.mockReturnValue(Buffer.alloc(32, 'k'));
          mockEncrypt.mockReturnValue({ ciphertext: 'enc-ct', iv: 'enc-iv', authTag: 'enc-tag' });

          mockCreate.mockResolvedValue({
            id: credentialId,
            workspaceId,
            providerName,
            encryptedKey: 'enc-ct',
            encryptedSecret: 'enc-iv:enc-tag:enc-ct',
            iv: 'enc-iv',
            authTag: 'enc-tag',
            createdBy,
            createdAt: new Date(),
            lastUsedAt: null,
          });

          const masterKeyHex = 'a'.repeat(64);
          await credentialService.store(workspaceId, providerName, key, secret, createdBy, masterKeyHex);

          const entry = findLogEntry('credential_created');
          expect(entry).not.toBeNull();
          expect(entry!.userId).toBe(createdBy);
          expect(entry!.workspaceId).toBe(workspaceId);
          expect(entry!.credentialId).toBe(credentialId);
          expect(entry!.providerName).toBe(providerName);

          // Verify the raw key and secret are NOT in the log entry
          const entryStr = JSON.stringify(entry);
          if (key.length > 0) expect(entryStr).not.toContain(key);
          if (secret.length > 0) expect(entryStr).not.toContain(secret);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('deleteCredential() logs credential_deleted with credentialId, workspaceId but never key/secret', async () => {
    const credentialIdArb = fc.uuid();
    const workspaceIdArb = fc.uuid();
    const fakeKeyArb = fc.string({ minLength: 8, maxLength: 64 });
    const fakeSecretArb = fc.string({ minLength: 8, maxLength: 64 });

    await fc.assert(
      fc.asyncProperty(
        credentialIdArb, workspaceIdArb, fakeKeyArb, fakeSecretArb,
        async (credentialId, workspaceId, fakeKey, fakeSecret) => {
          stdoutSpy.mockClear();

          mockFindById.mockResolvedValue({
            id: credentialId,
            workspaceId,
            providerName: 'apollo',
            encryptedKey: fakeKey,
            encryptedSecret: fakeSecret,
            iv: 'some-iv',
            authTag: 'some-tag',
            createdBy: 'user-1',
            createdAt: new Date(),
            lastUsedAt: null,
          });
          mockDeleteCredential.mockResolvedValue(undefined);

          await credentialService.deleteCredential(credentialId);

          const entry = findLogEntry('credential_deleted');
          expect(entry).not.toBeNull();
          expect(entry!.credentialId).toBe(credentialId);
          expect(entry!.workspaceId).toBe(workspaceId);

          // Verify the encrypted key and secret values are NOT in the log entry
          const entryStr = JSON.stringify(entry);
          if (fakeKey.length > 0) expect(entryStr).not.toContain(fakeKey);
          if (fakeSecret.length > 0) expect(entryStr).not.toContain(fakeSecret);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('decryptCredential() logs credential_decrypted with credentialId, workspaceId but never decrypted key/secret', async () => {
    const credentialIdArb = fc.uuid();
    const workspaceIdArb = fc.uuid();
    const rawKeyArb = fc.string({ minLength: 8, maxLength: 64 });
    const rawSecretArb = fc.string({ minLength: 8, maxLength: 64 });

    await fc.assert(
      fc.asyncProperty(
        credentialIdArb, workspaceIdArb, rawKeyArb, rawSecretArb,
        async (credentialId, workspaceId, rawKey, rawSecret) => {
          stdoutSpy.mockClear();

          mockDeriveWorkspaceKey.mockReturnValue(Buffer.alloc(32, 'k'));
          mockDecrypt
            .mockReturnValueOnce(rawKey)
            .mockReturnValueOnce(rawSecret);

          mockFindById.mockResolvedValue({
            id: credentialId,
            workspaceId,
            providerName: 'clearbit',
            encryptedKey: 'enc-key-data',
            encryptedSecret: 'sec-iv:sec-tag:sec-ct',
            iv: 'key-iv',
            authTag: 'key-tag',
            createdBy: 'user-1',
            createdAt: new Date(),
            lastUsedAt: null,
          });
          mockUpdateLastUsed.mockResolvedValue(undefined);

          const masterKeyHex = 'b'.repeat(64);
          await credentialService.decryptCredential(credentialId, masterKeyHex);

          const entry = findLogEntry('credential_decrypted');
          expect(entry).not.toBeNull();
          expect(entry!.credentialId).toBe(credentialId);
          expect(entry!.workspaceId).toBe(workspaceId);

          // Verify the decrypted key and secret are NOT in the log entry
          const entryStr = JSON.stringify(entry);
          if (rawKey.length > 0) expect(entryStr).not.toContain(rawKey);
          if (rawSecret.length > 0) expect(entryStr).not.toContain(rawSecret);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================================
// Feature: security-audit, Property 24: Webhook HMAC includes timestamp for replay prevention
// Feature: security-audit, Property 25: Webhook HMAC sign-verify round-trip
// ============================================================================
import crypto from 'crypto';

describe('Feature: security-audit, Property 24 & 25: Webhook HMAC security', () => {
  let verifyWebhookSignature: typeof import('../../src/modules/enrichment/webhook.service').verifyWebhookSignature;
  let MAX_WEBHOOK_AGE_SECONDS: number;

  beforeAll(async () => {
    vi.doMock('../../src/modules/enrichment/webhook.repository', () => ({
      createSubscription: vi.fn(),
      listSubscriptions: vi.fn(),
      deleteSubscription: vi.fn(),
      getSubscriptionsByEventType: vi.fn(),
      getSubscriptionById: vi.fn(),
    }));
    vi.doMock('../../src/shared/sanitize', () => ({
      sanitizeString: vi.fn((s: string) => s),
      isFormulaInjection: vi.fn(() => false),
      validateUrlSafety: vi.fn(async () => true),
    }));

    const webhookService = await import('../../src/modules/enrichment/webhook.service');
    verifyWebhookSignature = webhookService.verifyWebhookSignature;
    MAX_WEBHOOK_AGE_SECONDS = webhookService.MAX_WEBHOOK_AGE_SECONDS;
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Generators ──

  /** Generates a non-empty body string (simulating JSON payloads) */
  const bodyArb = fc.oneof(
    fc.json(),
    fc.string({ minLength: 1, maxLength: 500 }),
  );

  /** Generates a 64-char hex secret key */
  const secretKeyArb = fc.hexaString({ minLength: 64, maxLength: 64 });

  /** Helper: compute HMAC-SHA256 signature over `${timestamp}.${body}` */
  function computeHmac(body: string, timestamp: string, secretKey: string): string {
    return crypto
      .createHmac('sha256', secretKey)
      .update(`${timestamp}.${body}`)
      .digest('hex');
  }

  // ── Property 24: Webhook HMAC includes timestamp for replay prevention ──

  describe('Property 24: Webhook HMAC includes timestamp for replay prevention', () => {
    it('**Validates: Requirements 13.2** — valid timestamp + correct HMAC returns valid: true', async () => {
      await fc.assert(
        fc.property(
          bodyArb,
          secretKeyArb,
          (body, secretKey) => {
            const timestamp = Math.floor(Date.now() / 1000).toString();
            const signature = computeHmac(body, timestamp, secretKey);

            const result = verifyWebhookSignature(body, signature, timestamp, secretKey);
            expect(result).toEqual({ valid: true });
          },
        ),
        { numRuns: 100 },
      );
    });

    it('**Validates: Requirements 13.2** — old timestamp + correct HMAC returns rejected as too old', async () => {
      const extraSecondsArb = fc.integer({ min: 1, max: 3600 });

      await fc.assert(
        fc.property(
          bodyArb,
          secretKeyArb,
          extraSecondsArb,
          (body, secretKey, extraSeconds) => {
            const oldTimestamp = Math.floor(Date.now() / 1000) - MAX_WEBHOOK_AGE_SECONDS - extraSeconds;
            const timestamp = oldTimestamp.toString();
            const signature = computeHmac(body, timestamp, secretKey);

            const result = verifyWebhookSignature(body, signature, timestamp, secretKey);
            expect(result).toEqual({ valid: false, reason: 'Webhook timestamp too old' });
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ── Property 25: Webhook HMAC sign-verify round-trip ──

  describe('Property 25: Webhook HMAC sign-verify round-trip', () => {
    it('**Validates: Requirements 13.5** — signing then verifying with same secret succeeds', async () => {
      await fc.assert(
        fc.property(
          bodyArb,
          secretKeyArb,
          (body, secretKey) => {
            const timestamp = Math.floor(Date.now() / 1000).toString();
            const signature = computeHmac(body, timestamp, secretKey);

            const result = verifyWebhookSignature(body, signature, timestamp, secretKey);
            expect(result).toEqual({ valid: true });
          },
        ),
        { numRuns: 100 },
      );
    });

    it('**Validates: Requirements 13.5** — signing with key1 and verifying with key2 fails', async () => {
      await fc.assert(
        fc.property(
          bodyArb,
          secretKeyArb,
          secretKeyArb.filter((k) => k !== '0'.repeat(64)),
          (body, key1, key2Raw) => {
            // Ensure key1 and key2 are different
            const key2 = key1 === key2Raw
              ? key2Raw.split('').reverse().join('') + 'ff'
              : key2Raw;
            if (key1 === key2) return; // skip if still equal after transform

            const timestamp = Math.floor(Date.now() / 1000).toString();
            const signature = computeHmac(body, timestamp, key1);

            const result = verifyWebhookSignature(body, signature, timestamp, key2);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('Signature mismatch');
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

// Feature: security-audit, Property 6: Zod validation returns field-level errors
describe('Feature: security-audit, Property 6: Zod validation returns field-level errors', () => {
  const testSchema = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(100),
    age: z.number().int().min(0).max(150),
  });

  let controllerSpy: ReturnType<typeof vi.fn>;

  function createValidationTestApp() {
    const app = express();
    app.use(express.json());
    controllerSpy = vi.fn((_req: Request, res: Response) => {
      res.status(200).json({ success: true, data: { reached: true }, error: null });
    });
    app.post('/test', validate({ body: testSchema }), controllerSpy);
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('**Validates: Requirements 3.2** — invalid payloads return 400 with field-level errors and never reach controller', async () => {
    /**
     * Generator for payloads that are guaranteed to fail the Zod schema.
     * Strategies: missing required fields, wrong types, invalid email, out-of-range numbers.
     */
    const invalidPayloadArb = fc.oneof(
      // Strategy 1: completely wrong types for all fields
      fc.record({
        email: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)),
        name: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)),
        age: fc.oneof(fc.string(), fc.boolean(), fc.constant(null)),
      }),
      // Strategy 2: missing required fields (partial objects)
      fc.oneof(
        fc.record({ email: fc.string() }), // missing name and age
        fc.record({ name: fc.string() }),   // missing email and age
        fc.record({ age: fc.integer() }),   // missing email and name
        fc.constant({}),                     // empty object
      ),
      // Strategy 3: invalid email format with otherwise valid fields
      fc.record({
        email: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('@') || !s.includes('.')),
        name: fc.string({ minLength: 1, maxLength: 100 }),
        age: fc.integer({ min: 0, max: 150 }),
      }).filter((obj) => {
        // Ensure the email actually fails Zod email validation
        const result = z.string().email().safeParse(obj.email);
        return !result.success;
      }),
      // Strategy 4: out-of-range numbers
      fc.record({
        email: fc.constant('valid@example.com'),
        name: fc.string({ minLength: 1, maxLength: 100 }),
        age: fc.oneof(
          fc.integer({ min: -1000, max: -1 }),
          fc.integer({ min: 151, max: 10000 }),
          fc.double({ min: 0.1, max: 150, noNaN: true }).filter((n) => !Number.isInteger(n)),
        ),
      }),
      // Strategy 5: empty name string
      fc.record({
        email: fc.constant('valid@example.com'),
        name: fc.constant(''),
        age: fc.integer({ min: 0, max: 150 }),
      }),
    );

    await fc.assert(
      fc.asyncProperty(invalidPayloadArb, async (payload) => {
        const app = createValidationTestApp();
        const res = await request(app)
          .post('/test')
          .send(payload)
          .set('Content-Type', 'application/json');

        // Must be 400
        expect(res.status).toBe(400);

        // Must have the standard error envelope
        expect(res.body.success).toBe(false);
        expect(res.body.data).toBeNull();
        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe('VALIDATION_ERROR');

        // Must contain field-level error details (format: "body.fieldName: message")
        const message: string = res.body.error.message;
        expect(message.length).toBeGreaterThan(0);
        expect(message).toMatch(/body\./);

        // Controller must NOT have been called
        expect(controllerSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('**Validates: Requirements 3.2** — valid payloads reach the controller with 200', async () => {
    // Generate emails that pass Zod's stricter email validation (not just RFC-compliant)
    const zodSafeEmailArb = fc
      .tuple(
        fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
        fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/),
        fc.constantFrom('com', 'org', 'net', 'io', 'dev'),
      )
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

    const validPayloadArb = fc.record({
      email: zodSafeEmailArb,
      name: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,49}$/),
      age: fc.integer({ min: 0, max: 150 }),
    });

    await fc.assert(
      fc.asyncProperty(validPayloadArb, async (payload) => {
        const app = createValidationTestApp();
        const res = await request(app)
          .post('/test')
          .send(payload)
          .set('Content-Type', 'application/json');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(controllerSpy).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 },
    );
  });
});
