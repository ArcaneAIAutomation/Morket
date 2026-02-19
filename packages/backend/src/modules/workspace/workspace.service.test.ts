import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Workspace } from './workspace.repository';
import type { WorkspaceMembership } from './membership.repository';
import type { User } from '../auth/user.repository';

// --- Mock setup ---

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
};

vi.mock('../../shared/db', () => ({
  getPool: vi.fn(() => mockPool),
  query: vi.fn(),
}));

vi.mock('./workspace.repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workspace.repository')>();
  return {
    ...actual,
    generateSlug: vi.fn((name: string) => `${name.toLowerCase().replace(/\s+/g, '-')}-abc123`),
    createWorkspace: vi.fn(),
    findById: vi.fn(),
    findAllForUser: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
  };
});

vi.mock('./membership.repository', () => ({
  create: vi.fn(),
  findByUserAndWorkspace: vi.fn(),
  findAllForWorkspace: vi.fn(),
  updateRole: vi.fn(),
  deleteMembership: vi.fn(),
  countOwners: vi.fn(),
}));

vi.mock('../auth/user.repository', () => ({
  findByEmail: vi.fn(),
}));

import {
  create,
  list,
  getById,
  update,
  deleteWorkspace,
  addMember,
  removeMember,
  updateMemberRole,
} from './workspace.service';
import * as workspaceRepo from './workspace.repository';
import * as membershipRepo from './membership.repository';
import { findByEmail } from '../auth/user.repository';
import { NotFoundError, AuthorizationError, ConflictError } from '../../shared/errors';

const mockWorkspace: Workspace = {
  id: 'ws-uuid-1',
  name: 'Test Workspace',
  slug: 'test-workspace-abc123',
  ownerId: 'user-uuid-1',
  planType: 'free',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockMembership: WorkspaceMembership = {
  userId: 'user-uuid-1',
  workspaceId: 'ws-uuid-1',
  role: 'owner',
  invitedAt: new Date('2024-01-01'),
  acceptedAt: null,
};

const mockUser: User = {
  id: 'user-uuid-2',
  email: 'member@example.com',
  passwordHash: '$2b$12$hashed',
  name: 'Member User',
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('workspace.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  describe('create', () => {
    it('should create workspace, membership, and billing in a transaction', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({
          rows: [{
            id: 'ws-uuid-1',
            name: 'My Workspace',
            slug: 'my-workspace-abc123',
            owner_id: 'user-uuid-1',
            plan_type: 'free',
            created_at: new Date('2024-01-01'),
            updated_at: new Date('2024-01-01'),
          }],
        }) // INSERT workspace
        .mockResolvedValueOnce(undefined) // INSERT membership
        .mockResolvedValueOnce(undefined) // INSERT billing
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await create('My Workspace', 'user-uuid-1');

      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
      expect(result.name).toBe('My Workspace');
      expect(result.ownerId).toBe('user-uuid-1');
    });

    it('should rollback transaction on error', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')); // INSERT workspace fails

      await expect(create('Fail Workspace', 'user-uuid-1')).rejects.toThrow('DB error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should return all workspaces for the user', async () => {
      vi.mocked(workspaceRepo.findAllForUser).mockResolvedValue([mockWorkspace]);

      const result = await list('user-uuid-1');

      expect(workspaceRepo.findAllForUser).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toEqual([mockWorkspace]);
    });
  });

  describe('getById', () => {
    it('should return workspace when found', async () => {
      vi.mocked(workspaceRepo.findById).mockResolvedValue(mockWorkspace);

      const result = await getById('ws-uuid-1', 'user-uuid-1');

      expect(result).toEqual(mockWorkspace);
    });

    it('should throw NotFoundError when workspace does not exist', async () => {
      vi.mocked(workspaceRepo.findById).mockResolvedValue(null);

      await expect(getById('nonexistent', 'user-uuid-1')).rejects.toThrow(NotFoundError);
    });
  });

  describe('update', () => {
    it('should update workspace name', async () => {
      const updated = { ...mockWorkspace, name: 'Updated Name' };
      vi.mocked(workspaceRepo.findById).mockResolvedValue(mockWorkspace);
      vi.mocked(workspaceRepo.updateWorkspace).mockResolvedValue(updated);

      const result = await update('ws-uuid-1', { name: 'Updated Name' });

      expect(workspaceRepo.updateWorkspace).toHaveBeenCalledWith('ws-uuid-1', { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });

    it('should throw NotFoundError when workspace does not exist', async () => {
      vi.mocked(workspaceRepo.findById).mockResolvedValue(null);

      await expect(update('nonexistent', { name: 'X' })).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteWorkspace', () => {
    it('should delete workspace when found', async () => {
      vi.mocked(workspaceRepo.findById).mockResolvedValue(mockWorkspace);
      vi.mocked(workspaceRepo.deleteWorkspace).mockResolvedValue(undefined);

      await expect(deleteWorkspace('ws-uuid-1')).resolves.toBeUndefined();
      expect(workspaceRepo.deleteWorkspace).toHaveBeenCalledWith('ws-uuid-1');
    });

    it('should throw NotFoundError when workspace does not exist', async () => {
      vi.mocked(workspaceRepo.findById).mockResolvedValue(null);

      await expect(deleteWorkspace('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('addMember', () => {
    it('should add a member when user exists and is not already a member', async () => {
      vi.mocked(findByEmail).mockResolvedValue(mockUser);
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(null);
      const newMembership: WorkspaceMembership = {
        userId: mockUser.id,
        workspaceId: 'ws-uuid-1',
        role: 'member',
        invitedAt: new Date(),
        acceptedAt: null,
      };
      vi.mocked(membershipRepo.create).mockResolvedValue(newMembership);

      const result = await addMember('ws-uuid-1', 'member@example.com', 'member');

      expect(findByEmail).toHaveBeenCalledWith('member@example.com');
      expect(membershipRepo.findByUserAndWorkspace).toHaveBeenCalledWith(mockUser.id, 'ws-uuid-1');
      expect(membershipRepo.create).toHaveBeenCalledWith(mockUser.id, 'ws-uuid-1', 'member');
      expect(result.role).toBe('member');
    });

    it('should throw NotFoundError when user email is not found', async () => {
      vi.mocked(findByEmail).mockResolvedValue(null);

      await expect(addMember('ws-uuid-1', 'unknown@example.com', 'member')).rejects.toThrow(NotFoundError);
    });

    it('should throw ConflictError when user is already a member', async () => {
      vi.mocked(findByEmail).mockResolvedValue(mockUser);
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(mockMembership);

      await expect(addMember('ws-uuid-1', 'member@example.com', 'member')).rejects.toThrow(ConflictError);
    });
  });

  describe('removeMember', () => {
    it('should remove a non-owner member', async () => {
      const memberMembership: WorkspaceMembership = { ...mockMembership, role: 'member', userId: 'user-uuid-2' };
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(memberMembership);
      vi.mocked(membershipRepo.deleteMembership).mockResolvedValue(undefined);

      await expect(removeMember('ws-uuid-1', 'user-uuid-2')).resolves.toBeUndefined();
      expect(membershipRepo.deleteMembership).toHaveBeenCalledWith('user-uuid-2', 'ws-uuid-1');
    });

    it('should remove an owner when there are multiple owners', async () => {
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(mockMembership);
      vi.mocked(membershipRepo.countOwners).mockResolvedValue(2);
      vi.mocked(membershipRepo.deleteMembership).mockResolvedValue(undefined);

      await expect(removeMember('ws-uuid-1', 'user-uuid-1')).resolves.toBeUndefined();
      expect(membershipRepo.deleteMembership).toHaveBeenCalled();
    });

    it('should throw AuthorizationError when removing the last owner', async () => {
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(mockMembership);
      vi.mocked(membershipRepo.countOwners).mockResolvedValue(1);

      await expect(removeMember('ws-uuid-1', 'user-uuid-1')).rejects.toThrow(AuthorizationError);
      expect(membershipRepo.deleteMembership).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError when membership does not exist', async () => {
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(null);

      await expect(removeMember('ws-uuid-1', 'user-uuid-99')).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateMemberRole', () => {
    it('should update role for a non-owner member', async () => {
      const memberMembership: WorkspaceMembership = { ...mockMembership, role: 'member', userId: 'user-uuid-2' };
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(memberMembership);
      vi.mocked(membershipRepo.updateRole).mockResolvedValue({ ...memberMembership, role: 'admin' });

      await expect(updateMemberRole('ws-uuid-1', 'user-uuid-2', 'admin')).resolves.toBeUndefined();
      expect(membershipRepo.updateRole).toHaveBeenCalledWith('user-uuid-2', 'ws-uuid-1', 'admin');
    });

    it('should allow changing owner to non-owner when multiple owners exist', async () => {
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(mockMembership);
      vi.mocked(membershipRepo.countOwners).mockResolvedValue(2);
      vi.mocked(membershipRepo.updateRole).mockResolvedValue({ ...mockMembership, role: 'admin' });

      await expect(updateMemberRole('ws-uuid-1', 'user-uuid-1', 'admin')).resolves.toBeUndefined();
      expect(membershipRepo.updateRole).toHaveBeenCalledWith('user-uuid-1', 'ws-uuid-1', 'admin');
    });

    it('should throw AuthorizationError when downgrading the last owner', async () => {
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(mockMembership);
      vi.mocked(membershipRepo.countOwners).mockResolvedValue(1);

      await expect(updateMemberRole('ws-uuid-1', 'user-uuid-1', 'admin')).rejects.toThrow(AuthorizationError);
      expect(membershipRepo.updateRole).not.toHaveBeenCalled();
    });

    it('should allow changing owner role to owner (no-op check)', async () => {
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(mockMembership);
      vi.mocked(membershipRepo.updateRole).mockResolvedValue(mockMembership);

      await expect(updateMemberRole('ws-uuid-1', 'user-uuid-1', 'owner')).resolves.toBeUndefined();
      // Should NOT check countOwners since we're not downgrading
      expect(membershipRepo.countOwners).not.toHaveBeenCalled();
      expect(membershipRepo.updateRole).toHaveBeenCalled();
    });

    it('should throw NotFoundError when membership does not exist', async () => {
      vi.mocked(membershipRepo.findByUserAndWorkspace).mockResolvedValue(null);

      await expect(updateMemberRole('ws-uuid-1', 'user-uuid-99', 'admin')).rejects.toThrow(NotFoundError);
    });
  });
});
