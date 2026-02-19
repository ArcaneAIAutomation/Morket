import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { Request, Response, NextFunction } from 'express';
import type { WorkspaceRole } from '../../src/shared/types';

// ── Mock db module to prevent real connections ──
vi.mock('../../src/shared/db', () => ({
  query: vi.fn(),
  getPool: vi.fn(),
}));

import { requireRole, ROLE_HIERARCHY } from '../../src/middleware/rbac';
import { query } from '../../src/shared/db';
import { AuthorizationError } from '../../src/shared/errors';

// ── Constants ──
const ALL_ROLES: WorkspaceRole[] = ['viewer', 'member', 'admin', 'owner'];

// ── Generators ──
const roleArb = fc.constantFrom<WorkspaceRole>(...ALL_ROLES);

const uuidArb = fc.uuid().filter((u) => u.length > 0);

// ── Helpers ──
function makeMockReq(userId: string, workspaceId: string): Partial<Request> {
  return {
    user: { userId },
    params: { id: workspaceId } as Record<string, string>,
  };
}

function makeMockRes(): Partial<Response> {
  return {};
}

describe('Feature: core-backend-foundation, RBAC Properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 6: RBAC role hierarchy enforcement
   * For any (requiredRole, userRole) pair, access granted iff
   * ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole].
   * **Validates: Requirements 3.1, 3.2**
   */
  it('Property 6: RBAC role hierarchy enforcement', async () => {
    await fc.assert(
      fc.asyncProperty(roleArb, roleArb, uuidArb, uuidArb, async (requiredRole, userRole, userId, workspaceId) => {
        vi.clearAllMocks();

        // Mock DB to return the user's role in the workspace
        vi.mocked(query).mockResolvedValue({
          rows: [{ role: userRole }],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        });

        const req = makeMockReq(userId, workspaceId) as Request;
        const res = makeMockRes() as Response;
        const next = vi.fn() as unknown as NextFunction;

        const middleware = requireRole(requiredRole);

        const shouldAllow = ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];

        if (shouldAllow) {
          await middleware(req, res, next);
          expect(next).toHaveBeenCalledOnce();
          expect(vi.mocked(next).mock.calls[0][0]).toBeUndefined();
        } else {
          await middleware(req, res, next);
          expect(next).toHaveBeenCalledOnce();
          expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 7: RBAC workspace-scoped role
   * For any user with different roles in two different workspaces,
   * the correct workspace role is used for each workspace.
   * **Validates: Requirements 3.4**
   */
  it('Property 7: RBAC workspace-scoped role', async () => {
    // Generate two distinct roles to ensure they differ
    const distinctRolePairArb = fc
      .tuple(roleArb, roleArb)
      .filter(([a, b]) => a !== b);

    await fc.assert(
      fc.asyncProperty(
        distinctRolePairArb,
        uuidArb,
        uuidArb,
        uuidArb,
        async ([roleA, roleB], userId, workspaceIdA, workspaceIdB) => {
          fc.pre(workspaceIdA !== workspaceIdB);
          vi.clearAllMocks();

          // Mock DB to return the correct role based on workspace ID
          vi.mocked(query).mockImplementation(async (_text: string, params?: unknown[]) => {
            const wsId = params?.[1] as string;
            if (wsId === workspaceIdA) {
              return {
                rows: [{ role: roleA }],
                command: 'SELECT',
                rowCount: 1,
                oid: 0,
                fields: [],
              };
            }
            if (wsId === workspaceIdB) {
              return {
                rows: [{ role: roleB }],
                command: 'SELECT',
                rowCount: 1,
                oid: 0,
                fields: [],
              };
            }
            return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
          });

          // Use 'viewer' as minimum role so both roles pass the hierarchy check
          const middleware = requireRole('viewer');

          // ── Test workspace A ──
          const reqA = makeMockReq(userId, workspaceIdA) as Request;
          const resA = makeMockRes() as Response;
          const nextA = vi.fn() as unknown as NextFunction;

          await middleware(reqA, resA, nextA);
          expect(nextA).toHaveBeenCalledOnce();
          expect(reqA.user!.role).toBe(roleA);
          expect(reqA.user!.workspaceId).toBe(workspaceIdA);

          // ── Test workspace B ──
          const reqB = makeMockReq(userId, workspaceIdB) as Request;
          const resB = makeMockRes() as Response;
          const nextB = vi.fn() as unknown as NextFunction;

          await middleware(reqB, resB, nextB);
          expect(nextB).toHaveBeenCalledOnce();
          expect(reqB.user!.role).toBe(roleB);
          expect(reqB.user!.workspaceId).toBe(workspaceIdB);
        },
      ),
      { numRuns: 100 },
    );
  });
});
