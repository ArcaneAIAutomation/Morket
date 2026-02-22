import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AuthGuard from './AuthGuard';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

vi.mock('@/api/auth.api', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  connectAuthStore: vi.fn(),
  connectUIStore: vi.fn(),
}));

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

function renderWithRouter(isAuthenticated: boolean, workspaces: Array<{ id: string; name: string; createdAt: string; updatedAt: string }> = []) {
  useAuthStore.setState({ isAuthenticated });
  useWorkspaceStore.setState({
    workspaces,
    isLoading: false,
    fetchWorkspaces: vi.fn().mockResolvedValue(undefined),
    createWorkspace: vi.fn(),
    setActiveWorkspace: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route element={<AuthGuard />}>
          <Route path="/protected" element={<div>Protected Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login when not authenticated', () => {
    renderWithRouter(false);
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  it('shows workspace creation prompt when authenticated with no workspaces', async () => {
    // Mock fetchWorkspaces to resolve immediately so loaded becomes true
    const fetchWorkspaces = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ isAuthenticated: true });
    useWorkspaceStore.setState({
      workspaces: [],
      isLoading: false,
      fetchWorkspaces,
      createWorkspace: vi.fn(),
      setActiveWorkspace: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<AuthGuard />}>
            <Route path="/protected" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // Wait for the workspace prompt to appear
    expect(await screen.findByText('Welcome to Morket')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Workspace name')).toBeInTheDocument();
    expect(screen.getByText('Create workspace')).toBeInTheDocument();
  });

  it('renders children when authenticated with workspaces', async () => {
    const ws = { id: 'ws-1', name: 'Team A', createdAt: '2024-01-01', updatedAt: '2024-01-01' };
    const fetchWorkspaces = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ isAuthenticated: true });
    useWorkspaceStore.setState({
      workspaces: [ws],
      isLoading: false,
      fetchWorkspaces,
      createWorkspace: vi.fn(),
      setActiveWorkspace: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<AuthGuard />}>
            <Route path="/protected" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Protected Content')).toBeInTheDocument();
  });

  it('shows loading state while fetching workspaces', () => {
    useAuthStore.setState({ isAuthenticated: true });
    useWorkspaceStore.setState({
      workspaces: [],
      isLoading: true,
      fetchWorkspaces: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
      createWorkspace: vi.fn(),
      setActiveWorkspace: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route element={<AuthGuard />}>
            <Route path="/protected" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Loading workspaces/)).toBeInTheDocument();
  });
});
