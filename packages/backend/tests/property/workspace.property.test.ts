import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { WorkspaceRole } from '../../src/shared/types';
import type { Workspace } from '../../src/modules/workspace/workspace.repository';
import type { WorkspaceMembership } from '../../src/modules/workspace/membership.repository';

// ── Mock db module ──
const mockClient = { query: vi.fn(), release: vi.fn() };
const mockPool = { connect: vi.fn().mockResolvedValue(mockClient) };

vi.mock('../../src/shared/db', () => ({
  getPool: vi.fn(() => mockPool),
  query: vi.fn(),
}));

// ── Mock workspace.repository ──
vi.mock('../../src/modules/workspace/workspace.repository', () => ({
  createWorkspace: vi.fn(),
  findById: vi.fn(),
  findAllForUser: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  generateSlug: vi.fn((name: string) => `${name.toLowerCase().replace(/\s+/g, '-')}-abc123`),
}));

// ── Mock membership.repository ──
vi.mock('../../src/modules/workspace/membership.repository', () => ({
  create: vi.fn(),
  findByUserAndWorkspace: vi.fn(),
  findAllForWorkspace: vi.fn(),
  updateRole: vi.fn(),
  deleteMembership: vi.fn(),
  countOwners: vi.fn(),
}));

// ── Mock user.repository ──
vi.mock('../../src/modules/auth/user.repository', () => ({
  findByEmail: vi.fn(),
}));

import { create, list, addMember, removeMember, updateMemberRole } from '../../src/modules/workspace/workspace.service';
import { findAllForUser } from '../../src/modules/workspace/workspace.repository';
import * as membershipRepo from '../../src/modules/workspace/membership.repository';
import { findByEmail } from '../../src/modules/auth/user.repository';
import { AuthorizationError } from '../../src/shared/errors';

// ── Generators ──
const uuidArb = fc.uuid();
const workspaceNameArb = fc.string({ minLength: 1, maxLength: 50 });
const addableRoleArb = fc.constantFrom<WorkspaceRole>('admin', 'member', 'viewer');
const allRoleArb = fc.constantFrom<WorkspaceRole>('owner', 'admin', 'member', 'viewer');
const emailArb = fc.emailAddress();

// ── Helpers ──
function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'Test Workspace',
    slug: overrides.slug ?? 'test-workspace-abc123',
    ownerId: overrides.ownerId ?? crypto.randomUUID(),
    planType: overrides.planType ?? 'free',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMembership(overrides: Partial<WorkspaceMembership> = {}): WorkspaceMembership {
  return {
    userId: overrides.userId ?? crypto.randomUUID(),
    workspaceId: overrides.workspaceId ?? crypto.randomUUID(),
    role: overrides.role ?? 'member',
    invitedAt: new Date(),
    acceptedAt: new Date(),
    ...overrides,
  };
}

describe('Feature: core-backend-foundation, Workspace Properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  /**
   * Property 8: Workspace creation assigns owner membership
   * For any user creating a workspace, the resulting workspace_memberships table
   * should contain a record with that user's ID, the new workspace's ID, and role = 'owner'.
   * **Validates: Requirements 4.1**
   */
  it('Property 8: Workspace creation assigns owner membership', async () => {
    await fc.assert(
      fc.asyncProperty(workspaceNameArb, uuidArb, async (name, ownerId) => {
        vi.clearAllMocks();
        mockPool.connect.mockResolvedValue(mockClient);

        const workspaceId = crypto.randomUUID();

        // Set up mockClient.query to handle the transaction steps
        let queryCallIndex = 0;
        mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
          queryCallIndex++;
          const sqlUpper = typeof sql === 'string' ? sql.toUpperCase() : '';

          // 1. BEGIN
          if (sqlUpper.includes('BEGIN')) {
            return { rows: [], rowCount: 0 };
          }
          // 2. INSERT workspace
          if (sqlUpper.includes('INSERT INTO WORKSPACES')) {
            return {
              rows: [{
                id: workspaceId,
                name,
                slug: `${name.toLowerCase().replace(/\s+/g, '-')}-abc123`,
                owner_id: ownerId,
                plan_type: 'free',
                created_at: new Date(),
                updated_at: new Date(),
              }],
              rowCount: 1,
            };
          }
          // 3. INSERT membership
          if (sqlUpper.includes('INSERT INTO WORKSPACE_MEMBERSHIPS')) {
            return { rows: [], rowCount: 1 };
          }
          // 4. INSERT billing
          if (sqlUpper.includes('INSERT INTO BILLING')) {
            return { rows: [], rowCount: 1 };
          }
          // 5. COMMIT
          if (sqlUpper.includes('COMMIT')) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        });

        const workspace = await create(name, ownerId);

        expect(workspace.id).toBe(workspaceId);
        expect(workspace.ownerId).toBe(ownerId);

        // Verify membership INSERT was called with ownerId and role='owner'
        const membershipCall = mockClient.query.mock.calls.find(
          (call: unknown[]) => typeof call[0] === 'string' && call[0].toUpperCase().includes('INSERT INTO WORKSPACE_MEMBERSHIPS'),
        );
        expect(membershipCall).toBeDefined();
        const membershipParams = membershipCall![1] as unknown[];
        expect(membershipParams[0]).toBe(ownerId);
        expect(membershipParams[1]).toBe(workspaceId);
        // The SQL itself hardcodes role='owner'
        expect(membershipCall![0]).toContain("'owner'");
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 9: Workspace listing returns exactly user's workspaces
   * For any user with memberships in a set of workspaces W, calling list workspaces
   * should return exactly the workspaces in W — no more, no less.
   * **Validates: Requirements 4.2**
   */
  it('Property 9: Workspace listing returns exactly user\'s workspaces', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        fc.array(workspaceNameArb, { minLength: 0, maxLength: 10 }),
        async (userId, names) => {
          vi.clearAllMocks();

          const workspaces = names.map((name) => makeWorkspace({ name, ownerId: userId }));

          vi.mocked(findAllForUser).mockResolvedValue(workspaces);

          const result = await list(userId);

          expect(result).toHaveLength(workspaces.length);
          expect(result).toEqual(workspaces);

          // Verify findAllForUser was called with the correct userId
          expect(findAllForUser).toHaveBeenCalledWith(userId);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 10: Member addition creates correct membership
   * For any workspace and valid user, adding them as a member with a specified role
   * should create a workspace_membership record with that exact role.
   * **Validates: Requirements 4.6**
   */
  it('Property 10: Member addition creates correct membership', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, emailArb, addableRoleArb, uuidArb, async (workspaceId, email, role, targetUserId) => {
        vi.clearAllMocks();

        // Mock findByEmail to return a user
        vi.mocked(findByEmail).mockResolvedValue({
          id: targetUserId,
          email,
          passwordHash: 'hashed',
          name: 'Test User',
          avatarUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Mock no existing membership
        vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(null);

        // Mock create to return the membership
        const expectedMembership = makeMembership({
          userId: targetUserId,
          workspaceId,
          role,
        });
        vi.mocked(membershipRepo.create).mockResolvedValue(expectedMembership);

        const result = await addMember(workspaceId, email, role);

        expect(result.userId).toBe(targetUserId);
        expect(result.workspaceId).toBe(workspaceId);
        expect(result.role).toBe(role);

        // Verify create was called with correct args
        expect(membershipRepo.create).toHaveBeenCalledWith(targetUserId, workspaceId, role);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 11: Member removal deletes membership
   * For any workspace member who is not the last owner, removing them should result
   * in no membership record existing for that user-workspace pair.
   * **Validates: Requirements 4.7**
   */
  it('Property 11: Member removal deletes membership', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, uuidArb, allRoleArb, async (workspaceId, userId, role) => {
        vi.clearAllMocks();

        // Mock existing membership
        vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(
          makeMembership({ userId, workspaceId, role }),
        );

        // If role is owner, ensure there are multiple owners so removal is allowed
        if (role === 'owner') {
          vi.mocked(membershipRepo.countOwners).mockResolvedValue(2);
        }

        vi.mocked(membershipRepo.deleteMembership).mockResolvedValue(undefined);

        await removeMember(workspaceId, userId);

        // Verify deleteMembership was called with correct args
        expect(membershipRepo.deleteMembership).toHaveBeenCalledWith(userId, workspaceId);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 12: Member role update persists correctly
   * For any workspace member and a new valid role, updating their role should result
   * in the membership record reflecting the new role.
   * **Validates: Requirements 4.8**
   */
  it('Property 12: Member role update persists correctly', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, uuidArb, allRoleArb, allRoleArb, async (workspaceId, userId, currentRole, newRole) => {
        vi.clearAllMocks();

        // Mock existing membership with current role
        vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(
          makeMembership({ userId, workspaceId, role: currentRole }),
        );

        // If current role is owner and new role is not owner, ensure multiple owners
        if (currentRole === 'owner' && newRole !== 'owner') {
          vi.mocked(membershipRepo.countOwners).mockResolvedValue(2);
        }

        vi.mocked(membershipRepo.updateRole).mockResolvedValue(
          makeMembership({ userId, workspaceId, role: newRole }),
        );

        await updateMemberRole(workspaceId, userId, newRole);

        // Verify updateRole was called with the new role
        expect(membershipRepo.updateRole).toHaveBeenCalledWith(userId, workspaceId, newRole);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 13: Last owner protection invariant
   * For any workspace with exactly one owner, attempting to remove that owner or
   * change their role to a non-owner role should be rejected.
   * **Validates: Requirements 4.9**
   */
  it('Property 13: Last owner protection — removal rejected', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, uuidArb, async (workspaceId, userId) => {
        vi.clearAllMocks();

        // Mock existing membership as owner
        vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(
          makeMembership({ userId, workspaceId, role: 'owner' }),
        );

        // Only 1 owner
        vi.mocked(membershipRepo.countOwners).mockResolvedValue(1);

        await expect(removeMember(workspaceId, userId)).rejects.toThrow(AuthorizationError);

        // Verify deleteMembership was NOT called
        expect(membershipRepo.deleteMembership).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('Property 13: Last owner protection — role downgrade rejected', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, uuidArb, addableRoleArb, async (workspaceId, userId, newRole) => {
        // newRole is always non-owner (admin, member, viewer)
        vi.clearAllMocks();

        // Mock existing membership as owner
        vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(
          makeMembership({ userId, workspaceId, role: 'owner' }),
        );

        // Only 1 owner
        vi.mocked(membershipRepo.countOwners).mockResolvedValue(1);

        await expect(updateMemberRole(workspaceId, userId, newRole)).rejects.toThrow(AuthorizationError);

        // Verify updateRole was NOT called
        expect(membershipRepo.updateRole).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});
