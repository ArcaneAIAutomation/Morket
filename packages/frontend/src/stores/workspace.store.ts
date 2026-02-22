import { create } from 'zustand';
import type { Workspace, WorkspaceMember, WorkspaceRole } from '@/types/api.types';
import * as workspaceApi from '@/api/workspace.api';
import * as membersApi from '@/api/members.api';

const LAST_WORKSPACE_KEY = 'morket_lastWorkspaceId';

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  currentRole: WorkspaceRole | null;
  members: WorkspaceMember[];
  isLoading: boolean;

  fetchWorkspaces: () => Promise<void>;
  setActiveWorkspace: (id: string) => void;
  createWorkspace: (name: string) => Promise<Workspace>;
  updateWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  fetchMembers: (workspaceId: string) => Promise<void>;
  inviteMember: (workspaceId: string, email: string, role: WorkspaceRole) => Promise<void>;
  updateMemberRole: (workspaceId: string, userId: string, role: WorkspaceRole) => Promise<void>;
  removeMember: (workspaceId: string, userId: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: localStorage.getItem(LAST_WORKSPACE_KEY),
  currentRole: null,
  members: [],
  isLoading: false,

  fetchWorkspaces: async () => {
    set({ isLoading: true });
    try {
      const workspaces = await workspaceApi.getWorkspaces();
      set({ workspaces, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  setActiveWorkspace: (id) => {
    localStorage.setItem(LAST_WORKSPACE_KEY, id);
    set({ activeWorkspaceId: id });
  },

  createWorkspace: async (name) => {
    set({ isLoading: true });
    try {
      const workspace = await workspaceApi.createWorkspace(name);
      set((state) => ({
        workspaces: [...state.workspaces, workspace],
        isLoading: false,
      }));
      return workspace;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  updateWorkspace: async (id, name) => {
    const updated = await workspaceApi.updateWorkspace(id, name);
    set((state) => ({
      workspaces: state.workspaces.map((w) => (w.id === id ? updated : w)),
    }));
  },

  deleteWorkspace: async (id) => {
    await workspaceApi.deleteWorkspace(id);
    set((state) => {
      const workspaces = state.workspaces.filter((w) => w.id !== id);
      const activeWorkspaceId =
        state.activeWorkspaceId === id ? null : state.activeWorkspaceId;
      if (activeWorkspaceId === null) {
        localStorage.removeItem(LAST_WORKSPACE_KEY);
      }
      return { workspaces, activeWorkspaceId };
    });
  },

  fetchMembers: async (workspaceId) => {
    const members = await membersApi.getMembers(workspaceId);
    set({ members });
  },

  inviteMember: async (workspaceId, email, role) => {
    const member = await membersApi.inviteMember(workspaceId, email, role);
    set((state) => ({ members: [...state.members, member] }));
  },

  updateMemberRole: async (workspaceId, userId, role) => {
    await membersApi.updateMemberRole(workspaceId, userId, role);
    set((state) => ({
      members: state.members.map((m) =>
        m.userId === userId ? { ...m, role } : m,
      ),
    }));
  },

  removeMember: async (workspaceId, userId) => {
    await membersApi.removeMember(workspaceId, userId);
    set((state) => ({
      members: state.members.filter((m) => m.userId !== userId),
    }));
  },
}));
