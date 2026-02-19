import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  create,
  findByUserAndWorkspace,
  findAllForWorkspace,
  updateRole,
  deleteMembership,
  countOwners,
} from './membership.repository';

const mockQuery = vi.fn();
vi.mock('../../shared/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const now = new Date('2024-01-01T00:00:00Z');

const sampleRow = {
  user_id: 'user-aaaa-bbbb-cccc-dddddddddddd',
  workspace_id: 'ws-1111-2222-3333-444444444444',
  role: 'member' as const,
  invited_at: now,
  accepted_at: null,
};

const expectedMembership = {
  userId: sampleRow.user_id,
  workspaceId: sampleRow.workspace_id,
  role: sampleRow.role,
  invitedAt: now,
  acceptedAt: null,
};

describe('membership.repository', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('create', () => {
    it('inserts with parameterized query and returns mapped membership', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const membership = await create(
        sampleRow.user_id,
        sampleRow.workspace_id,
        'member',
      );

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO workspace_memberships');
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain('$3');
      expect(params).toEqual([sampleRow.user_id, sampleRow.workspace_id, 'member']);
      expect(membership).toEqual(expectedMembership);
    });
  });

  describe('findByUserAndWorkspace', () => {
    it('returns mapped membership when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const membership = await findByUserAndWorkspace(
        sampleRow.user_id,
        sampleRow.workspace_id,
      );

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('SELECT');
      expect(sql).toContain('WHERE user_id = $1 AND workspace_id = $2');
      expect(params).toEqual([sampleRow.user_id, sampleRow.workspace_id]);
      expect(membership).toEqual(expectedMembership);
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const membership = await findByUserAndWorkspace('no-user', 'no-ws');

      expect(membership).toBeNull();
    });
  });

  describe('findAllForWorkspace', () => {
    it('returns all mapped memberships for a workspace', async () => {
      const ownerRow = { ...sampleRow, role: 'owner' as const };
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow, ownerRow] });

      const memberships = await findAllForWorkspace(sampleRow.workspace_id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('SELECT');
      expect(sql).toContain('WHERE workspace_id = $1');
      expect(params).toEqual([sampleRow.workspace_id]);
      expect(memberships).toHaveLength(2);
      expect(memberships[0]).toEqual(expectedMembership);
      expect(memberships[1].role).toBe('owner');
    });

    it('returns empty array when workspace has no members', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const memberships = await findAllForWorkspace('empty-ws');

      expect(memberships).toEqual([]);
    });
  });

  describe('updateRole', () => {
    it('updates role with parameterized query and returns mapped membership', async () => {
      const updatedRow = { ...sampleRow, role: 'admin' as const };
      mockQuery.mockResolvedValueOnce({ rows: [updatedRow] });

      const membership = await updateRole(
        sampleRow.user_id,
        sampleRow.workspace_id,
        'admin',
      );

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('UPDATE workspace_memberships');
      expect(sql).toContain('SET role = $3');
      expect(sql).toContain('WHERE user_id = $1 AND workspace_id = $2');
      expect(params).toEqual([sampleRow.user_id, sampleRow.workspace_id, 'admin']);
      expect(membership.role).toBe('admin');
    });
  });

  describe('deleteMembership', () => {
    it('deletes with parameterized query', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await deleteMembership(sampleRow.user_id, sampleRow.workspace_id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('DELETE FROM workspace_memberships');
      expect(sql).toContain('WHERE user_id = $1 AND workspace_id = $2');
      expect(params).toEqual([sampleRow.user_id, sampleRow.workspace_id]);
    });
  });

  describe('countOwners', () => {
    it('returns the count of owners for a workspace', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });

      const count = await countOwners(sampleRow.workspace_id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('SELECT COUNT(*)');
      expect(sql).toContain("role = 'owner'");
      expect(sql).toContain('WHERE workspace_id = $1');
      expect(params).toEqual([sampleRow.workspace_id]);
      expect(count).toBe(2);
    });

    it('returns 0 when no owners exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const count = await countOwners('orphan-ws');

      expect(count).toBe(0);
    });
  });
});
