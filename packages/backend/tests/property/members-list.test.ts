// Feature: menu-fixes-options-config, Property 2: Members endpoint returns complete member data
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { WorkspaceRole } from '../../src/shared/types';
import type { Workspace } from '../../src/modules/workspace/workspace.repository';
import type { MemberWithUser } from '../../src/modules/workspace/membership.repository';

// ── Mock db module ──
vi.mock('../../src/shared/db', () => ({
  getPool: vi.fn(() => ({ connect: vi.fn() })),
  query: vi.fn(),
}));

// ── Mock workspace.repository ──
vi.mock('../../src/modules/workspace/workspace.repository', () => ({
  findById: vi.fn(),
  createWorkspace: vi.fn(),
  findAllForUser: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  generateSlug: vi.fn(),
}));

// ── Mock membership.repository ──
vi.mock('../../src/modules/workspace/membership.repository', () => ({
  create: vi.fn(),
  findByUserAndWorkspace: vi.fn(),
  findFirstForUser: vi.fn(),
  findAllForWorkspace: vi.fn(),
  findAllWithUsers: vi.fn(),
  updateRole: vi.fn(),
  deleteMembership: vi.fn(),
  countOwners: vi.fn(),
}));

// ── Mock user.repository ──
vi.mock('../../src/modules/auth/user.repository', () => ({
  findByEmail: vi.fn(),
}));

import { listMembers } from '../../src/modules/workspace/workspace.service';
import { findById } from '../../src/modules/workspace/workspace.repository';
import { findAllWithUsers } from '../../src/modules/workspace/membership.repository';

// ── Generators ──
const roleArb = fc.constantFrom<WorkspaceRole>('owner', 'admin', 'member', 'viewer');

const memberWithUserArb = fc.record({
  userId: fc.uuid(),
  email: fc.emailAddress(),
  displayName: fc.string({ minLength: 1, maxLength: 50 }),
  role: roleArb,
  joinedAt: fc.date(),
});

function makeWorkspace(id: string): Workspace {
  return {
    id,
    name: 'Test Workspace',
    slug: 'test-workspace-abc123',
    ownerId: crypto.randomUUID(),
    planType: 'free',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('Feature: menu-fixes-options-config, Property 2: Members endpoint returns complete member data', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  /**
   * Property 2: Members endpoint returns complete member data
   * For any workspace with N memberships in the database, calling listMembers(workspaceId)
   * should return exactly N member objects, and each object should contain non-null
   * userId, email, displayName, role, and joinedAt fields.
   * **Validates: Requirements 3.1, 3.2**
   */
  it('returns exactly N members with all required fields non-null', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(memberWithUserArb, { minLength: 1, maxLength: 20 }),
        async (workspaceId, members) => {
          vi.resetAllMocks();

          // Mock workspace exists
          vi.mocked(findById).mockResolvedValue(makeWorkspace(workspaceId));

          // Mock membership repo returns the generated members
          const memberRecords: MemberWithUser[] = members.map((m) => ({
            userId: m.userId,
            email: m.email,
            displayName: m.displayName,
            role: m.role,
            joinedAt: m.joinedAt,
          }));
          vi.mocked(findAllWithUsers).mockResolvedValue(memberRecords);

          const result = await listMembers(workspaceId);

          // Verify count matches
          expect(result).toHaveLength(members.length);

          // Verify each member has all required fields non-null
          for (const member of result) {
            expect(member.userId).not.toBeNull();
            expect(member.userId).toBeDefined();
            expect(typeof member.userId).toBe('string');

            expect(member.email).not.toBeNull();
            expect(member.email).toBeDefined();
            expect(typeof member.email).toBe('string');

            expect(member.displayName).not.toBeNull();
            expect(member.displayName).toBeDefined();
            expect(typeof member.displayName).toBe('string');

            expect(member.role).not.toBeNull();
            expect(member.role).toBeDefined();
            expect(['owner', 'admin', 'member', 'viewer', 'billing_admin']).toContain(member.role);

            expect(member.joinedAt).not.toBeNull();
            expect(member.joinedAt).toBeDefined();
          }

          // Verify the service called the repo with the correct workspaceId
          expect(findById).toHaveBeenCalledWith(workspaceId);
          expect(findAllWithUsers).toHaveBeenCalledWith(workspaceId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
