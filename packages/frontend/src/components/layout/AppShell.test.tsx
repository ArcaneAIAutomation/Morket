import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AppShell from './AppShell';
import { useUIStore } from '@/stores/ui.store';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

// Mock child components to isolate AppShell layout behavior
vi.mock('@/components/layout/Sidebar', () => ({
  default: () => <nav data-testid="sidebar">Sidebar</nav>,
}));

vi.mock('@/components/layout/Header', () => ({
  default: () => <header data-testid="header">Header</header>,
}));

vi.mock('@/api/client', () => ({
  connectAuthStore: vi.fn(),
  connectUIStore: vi.fn(),
}));

vi.mock('@/api/auth.api', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
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

function renderAppShell() {
  return render(
    <MemoryRouter initialEntries={['/workspaces/ws-1/spreadsheet']}>
      <Routes>
        <Route path="/workspaces/:workspaceId/*" element={<AppShell />}>
          <Route path="spreadsheet" element={<div data-testid="content">Spreadsheet</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ isSidebarOpen: false, isSidebarCollapsed: false });
    useAuthStore.setState({
      user: { id: 'u-1', email: 'test@test.com', displayName: 'Test', createdAt: '2024-01-01' },
      isAuthenticated: true,
    });
    useWorkspaceStore.setState({
      workspaces: [{ id: 'ws-1', name: 'Team A', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      activeWorkspaceId: 'ws-1',
    });
  });

  it('renders header, sidebar, and outlet content', () => {
    renderAppShell();

    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('desktop sidebar is rendered in a hidden-on-mobile container', () => {
    renderAppShell();

    // The desktop sidebar wrapper has class "hidden md:flex"
    const sidebar = screen.getByTestId('sidebar');
    const desktopWrapper = sidebar.parentElement;
    expect(desktopWrapper?.className).toContain('hidden');
    expect(desktopWrapper?.className).toContain('md:flex');
  });

  it('shows mobile sidebar overlay when isSidebarOpen is true', () => {
    useUIStore.setState({ isSidebarOpen: true });
    renderAppShell();

    // When open, there should be two sidebars: desktop (hidden) + mobile overlay
    const sidebars = screen.getAllByTestId('sidebar');
    expect(sidebars.length).toBe(2);
  });

  it('does not show mobile overlay when isSidebarOpen is false', () => {
    useUIStore.setState({ isSidebarOpen: false });
    renderAppShell();

    // Only the desktop sidebar should be present
    const sidebars = screen.getAllByTestId('sidebar');
    expect(sidebars.length).toBe(1);
  });

  it('clicking overlay backdrop closes mobile sidebar', () => {
    const setSidebarOpen = vi.fn();
    useUIStore.setState({ isSidebarOpen: true, setSidebarOpen });

    renderAppShell();

    // The backdrop is the div with bg-black/40 class
    const backdrop = document.querySelector('.fixed.inset-0');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);

    expect(setSidebarOpen).toHaveBeenCalledWith(false);
  });
});
