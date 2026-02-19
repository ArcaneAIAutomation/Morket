import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWorkspace,
  findById,
  findAllForUser,
  updateWorkspace,
  deleteWorkspace,
  generateSlug,
} from './workspace.repository';

const mockQuery = vi.fn();
vi.mock('../../shared/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const now = new Date('2024-01-01T00:00:00Z');

const sampleRow = {
  id: 'ws-1111-2222-3333-444444444444',
  name: 'My Workspace',
  slug: 'my-workspace-abc123',
  owner_id: 'user-aaaa-bbbb-cccc-dddddddddddd',
  plan_type: 'free' as const,
  created_at: now,
  updated_at: now,
};

const expectedWorkspace = {
  id: sampleRow.id,
  name: sampleRow.name,
  slug: sampleRow.slug,
  ownerId: sampleRow.owner_id,
  planType: sampleRow.plan_type,
  createdAt: now,
  updatedAt: now,
};

describe('workspace.repository', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('generateSlug', () => {
    it('lowercases and replaces spaces with hyphens', () => {
      const slug = generateSlug('My Workspace');
      expect(slug).toMatch(/^my-workspace-[a-z0-9]{6}$/);
    });

    it('strips non-alphanumeric characters', () => {
      const slug = generateSlug('Hello World!@#$%');
      expect(slug).toMatch(/^hello-world-[a-z0-9]{6}$/);
    });

    it('collapses consecutive spaces/hyphens', () => {
      const slug = generateSlug('too   many   spaces');
      expect(slug).toMatch(/^too-many-spaces-[a-z0-9]{6}$/);
    });

    it('appends a random suffix for uniqueness', () => {
      const slug1 = generateSlug('test');
      const slug2 = generateSlug('test');
      // Extremely unlikely to collide
      expect(slug1).not.toBe(slug2);
    });
  });

  describe('createWorkspace', () => {
    it('inserts with parameterized query and returns mapped Workspace', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const ws = await createWorkspace('My Workspace', sampleRow.owner_id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO workspaces');
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain('$3');
      expect(params[0]).toBe('My Workspace');
      // params[1] is the generated slug
      expect(typeof params[1]).toBe('string');
      expect(params[2]).toBe(sampleRow.owner_id);
      expect(ws).toEqual(expectedWorkspace);
    });
  });

  describe('findById', () => {
    it('returns mapped Workspace when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const ws = await findById(sampleRow.id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('SELECT');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([sampleRow.id]);
      expect(ws).toEqual(expectedWorkspace);
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const ws = await findById('nonexistent-id');

      expect(ws).toBeNull();
    });
  });

  describe('findAllForUser', () => {
    it('joins workspace_memberships and returns mapped Workspaces', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const workspaces = await findAllForUser('user-id-123');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INNER JOIN workspace_memberships');
      expect(sql).toContain('wm.workspace_id = w.id');
      expect(sql).toContain('wm.user_id = $1');
      expect(params).toEqual(['user-id-123']);
      expect(workspaces).toEqual([expectedWorkspace]);
    });

    it('returns empty array when user has no memberships', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const workspaces = await findAllForUser('lonely-user');

      expect(workspaces).toEqual([]);
    });
  });

  describe('updateWorkspace', () => {
    it('updates name with parameterized query and returns mapped Workspace', async () => {
      const updatedRow = { ...sampleRow, name: 'Renamed' };
      mockQuery.mockResolvedValueOnce({ rows: [updatedRow] });

      const ws = await updateWorkspace(sampleRow.id, { name: 'Renamed' });

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('UPDATE workspaces');
      expect(sql).toContain('COALESCE($2, name)');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([sampleRow.id, 'Renamed']);
      expect(ws.name).toBe('Renamed');
    });

    it('passes null when name is not provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      await updateWorkspace(sampleRow.id, {});

      const [, params] = mockQuery.mock.calls[0];
      expect(params).toEqual([sampleRow.id, null]);
    });
  });

  describe('deleteWorkspace', () => {
    it('deletes with parameterized query', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await deleteWorkspace(sampleRow.id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('DELETE FROM workspaces');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([sampleRow.id]);
    });
  });
});
