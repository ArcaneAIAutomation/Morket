import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useUIStore } from '@/stores/ui.store';
import SearchBar from '@/components/search/SearchBar';
import { sanitizeHtml } from '@/utils/sanitize';

export default function Header() {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);

  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);

  const activeWorkspace = workspaces.find((w) => w.id === workspaceId);
  const avatarLetter = user?.displayName?.charAt(0).toUpperCase() ?? '?';

  const handleWorkspaceSwitch = (id: string) => {
    setActiveWorkspace(id);
    setWsDropdownOpen(false);
    navigate(`/workspaces/${id}/spreadsheet`);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <button
          onClick={() => setSidebarOpen(!isSidebarOpen)}
          className="md:hidden p-1.5 rounded hover:bg-gray-100 text-gray-600"
          aria-label="Toggle navigation"
        >
          ☰
        </button>

        {/* Workspace switcher */}
        <div className="relative">
          <button
            onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 text-sm font-medium text-gray-700"
          >
            {activeWorkspace?.name ? sanitizeHtml(activeWorkspace.name) : 'Select workspace'}
            <span className="text-xs text-gray-400">▼</span>
          </button>

          {wsDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-40">
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => handleWorkspaceSwitch(ws.id)}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${
                    ws.id === workspaceId ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                  }`}
                >
                  {sanitizeHtml(ws.name)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Search bar */}
        <SearchBar />

        {/* User avatar */}
        <div
          className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium"
          title={user?.displayName ?? ''}
        >
          {avatarLetter}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
