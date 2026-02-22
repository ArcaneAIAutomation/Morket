import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkspaceStore } from './workspace.store';

vi.mock('@/api/workspace.api', () => ({
  getWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

vi.mock('@/api/members.api', () => ({
  getMembers: vi.fn(),
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

import * as workspaceApi from '@/api/workspace.api';
import * as membersApi from '@/api/members.api';

const LAST_WORKSPACE_KEY = 'morket_lastWorkspaceId';

const mockWorkspace = (id: string, name: string) => ({
  id,
  name,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
});

describe('workspace.store', () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      currentRole: null,
      members: [],
      isLoading: false,
    });
    vi.clearAllMocks();
  });

  describe('fetchWorkspaces', () => {
    it('loads workspaces from API', async () => {
      const workspaces = [mockWorkspace('ws-1', 'Team A'), mockWorkspace('ws-2', 'Team B')];
      vi.mocked(workspaceApi.getWorkspaces).mockResolvedValue(workspaces);

      await useWorkspaceStore.getState().fetchWorkspaces();

      expect(useWorkspaceStore.getState().workspaces).toEqual(workspaces);
      expect(useWorkspaceStore.getState().isLoading).toBe(false);
    });

    it('resets isLoading on failure', async () => {
      vi.mocked(workspaceApi.getWorkspaces).mockRejectedValue(new Error('Network'));

      await expect(useWorkspaceStore.getState().fetchWorkspaces()).rejects.toThrow();
      expect(useWorkspaceStore.getState().isLoading).toBe(false);
    });
  });

  describe('setActiveWorkspace', () => {
    it('persists workspace ID to localStorage', () => {
      useWorkspaceStore.getState().setActiveWorkspace('ws-1');

      expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBe('ws-1');
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1');
    });
  });

  describe('createWorkspace', () => {
    it('adds workspace to list and returns it', async () => {
      const ws = mockWorkspace('ws-new', 'New Workspace');
      vi.mocked(workspaceApi.createWorkspace).mockResolvedValue(ws);

      const result = await useWorkspaceStore.getState().createWorkspace('New Workspace');

      expect(result).toEqual(ws);
      expect(useWorkspaceStore.getState().workspaces).toContainEqual(ws);
    });
  });

  describe('updateWorkspace', () => {
    it('updates workspace in list', async () => {
      const original = mockWorkspace('ws-1', 'Old Name');
      const updated = mockWorkspace('ws-1', 'New Name');
      useWorkspaceStore.setState({ workspaces: [original] });
      vi.mocked(workspaceApi.updateWorkspace).mockResolvedValue(updated);

      await useWorkspaceStore.getState().updateWorkspace('ws-1', 'New Name');

      expect(useWorkspaceStore.getState().workspaces[0].name).toBe('New Name');
    });
  });

  describe('deleteWorkspace', () => {
    it('removes workspace from list', async () => {
      useWorkspaceStore.setState({
        workspaces: [mockWorkspace('ws-1', 'Team A'), mockWorkspace('ws-2', 'Team B')],
        activeWorkspaceId: 'ws-2',
      });
      vi.mocked(workspaceApi.deleteWorkspace).mockResolvedValue(undefined);

      await useWorkspaceStore.getState().deleteWorkspace('ws-1');

      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2');
    });

    it('clears activeWorkspaceId if deleted workspace was active', async () => {
      localStorage.setItem(LAST_WORKSPACE_KEY, 'ws-1');
      useWorkspaceStore.setState({
        workspaces: [mockWorkspace('ws-1', 'Team A')],
        activeWorkspaceId: 'ws-1',
      });
      vi.mocked(workspaceApi.deleteWorkspace).mockResolvedValue(undefined);

      await useWorkspaceStore.getState().deleteWorkspace('ws-1');

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
      expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBeNull();
    });
  });

  describe('member operations', () => {
    it('fetchMembers loads members', async () => {
      const members = [{ userId: 'u1', email: 'a@b.com', displayName: 'A', role: 'admin' as const, joinedAt: '2024-01-01' }];
      vi.mocked(membersApi.getMembers).mockResolvedValue(members);

      await useWorkspaceStore.getState().fetchMembers('ws-1');
      expect(useWorkspaceStore.getState().members).toEqual(members);
    });

    it('inviteMember adds member to list', async () => {
      const member = { userId: 'u2', email: 'b@c.com', displayName: 'B', role: 'member' as const, joinedAt: '2024-01-02' };
      vi.mocked(membersApi.inviteMember).mockResolvedValue(member);

      await useWorkspaceStore.getState().inviteMember('ws-1', 'b@c.com', 'member');
      expect(useWorkspaceStore.getState().members).toContainEqual(member);
    });

    it('updateMemberRole updates role in list', async () => {
      useWorkspaceStore.setState({
        members: [{ userId: 'u1', email: 'a@b.com', displayName: 'A', role: 'member', joinedAt: '2024-01-01' }],
      });
      vi.mocked(membersApi.updateMemberRole).mockResolvedValue(undefined);

      await useWorkspaceStore.getState().updateMemberRole('ws-1', 'u1', 'admin');
      expect(useWorkspaceStore.getState().members[0].role).toBe('admin');
    });

    it('removeMember removes member from list', async () => {
      useWorkspaceStore.setState({
        members: [
          { userId: 'u1', email: 'a@b.com', displayName: 'A', role: 'admin', joinedAt: '2024-01-01' },
          { userId: 'u2', email: 'b@c.com', displayName: 'B', role: 'member', joinedAt: '2024-01-02' },
        ],
      });
      vi.mocked(membersApi.removeMember).mockResolvedValue(undefined);

      await useWorkspaceStore.getState().removeMember('ws-1', 'u1');
      expect(useWorkspaceStore.getState().members).toHaveLength(1);
      expect(useWorkspaceStore.getState().members[0].userId).toBe('u2');
    });
  });
});
