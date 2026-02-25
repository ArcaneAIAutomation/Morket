import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MemberSettings from './MemberSettings';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { WorkspaceMember } from '@/types/api.types';

// Mock dependencies
vi.mock('@/api/members.api', () => ({
  getMembers: vi.fn().mockResolvedValue([]),
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock('@/api/workspace.api', () => ({
  getWorkspaces: vi.fn().mockResolvedValue([]),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

const mockMember: WorkspaceMember = {
  userId: 'u1',
  email: 'alice@example.com',
  displayName: 'Alice',
  role: 'member',
  joinedAt: '2025-01-01T00:00:00.000Z',
};

function setStoreState(overrides: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState(overrides);
}

describe('MemberSettings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useWorkspaceStore.setState({
      activeWorkspaceId: 'ws-1',
      currentRole: 'admin',
      members: [],
      fetchMembers: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('shows loading indicator while fetching members', async () => {
    // fetchMembers that never resolves to keep loading state
    let resolveFetch: () => void;
    const pendingPromise = new Promise<void>((resolve) => { resolveFetch = resolve; });
    setStoreState({ fetchMembers: vi.fn().mockReturnValue(pendingPromise) });

    render(<MemberSettings />);

    expect(screen.getByLabelText('Loading members')).toBeInTheDocument();
    expect(screen.getByText('Loading members…')).toBeInTheDocument();

    // Cleanup
    resolveFetch!();
  });

  it('shows inline error with Retry button when fetch fails', async () => {
    setStoreState({
      fetchMembers: vi.fn().mockRejectedValue({ message: 'Network error' }),
    });

    render(<MemberSettings />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows fallback error message when error has no message property', async () => {
    setStoreState({
      fetchMembers: vi.fn().mockRejectedValue('something broke'),
    });

    render(<MemberSettings />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load members.')).toBeInTheDocument();
    });
  });

  it('shows empty state message with invite form visible', async () => {
    setStoreState({
      members: [],
      fetchMembers: vi.fn().mockResolvedValue(undefined),
    });

    render(<MemberSettings />);

    await waitFor(() => {
      expect(
        screen.getByText('No other members yet. Invite someone to get started.'),
      ).toBeInTheDocument();
    });

    // Invite form should be visible in empty state
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invite/i })).toBeInTheDocument();
  });

  it('renders member table when members exist', async () => {
    setStoreState({
      members: [mockMember],
      fetchMembers: vi.fn().mockResolvedValue(undefined),
    });

    render(<MemberSettings />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('Retry button re-fetches members', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce({ message: 'Server error' })
      .mockResolvedValueOnce(undefined);

    setStoreState({ fetchMembers: fetchMock });

    render(<MemberSettings />);

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('hides member table during loading', () => {
    let resolveFetch: () => void;
    const pendingPromise = new Promise<void>((resolve) => { resolveFetch = resolve; });
    setStoreState({
      members: [mockMember],
      fetchMembers: vi.fn().mockReturnValue(pendingPromise),
    });

    render(<MemberSettings />);

    expect(screen.getByLabelText('Loading members')).toBeInTheDocument();
    // Table should not be visible while loading
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();

    resolveFetch!();
  });

  it('shows no workspace message when no workspace selected', () => {
    setStoreState({ activeWorkspaceId: null });

    render(<MemberSettings />);

    expect(screen.getByText('No workspace selected.')).toBeInTheDocument();
  });
});
