import { useEffect, useState } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

export default function AuthGuard() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const isLoading = useWorkspaceStore((s) => s.isLoading);
  const navigate = useNavigate();

  const [loaded, setLoaded] = useState(false);
  const [wsName, setWsName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !loaded) {
      fetchWorkspaces()
        .then(() => setLoaded(true))
        .catch(() => setLoaded(true));
    }
  }, [isAuthenticated, loaded, fetchWorkspaces]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!loaded || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500 text-sm">
        Loading workspaces…
      </div>
    );
  }

  if (workspaces.length === 0) {
    const handleCreate = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!wsName.trim() || creating) return;
      setCreating(true);
      try {
        const ws = await createWorkspace(wsName.trim());
        setActiveWorkspace(ws.id);
        navigate(`/workspaces/${ws.id}/spreadsheet`);
      } catch {
        setCreating(false);
      }
    };

    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
        <div className="w-full max-w-sm bg-white rounded-lg shadow p-8 text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Welcome to Morket</h2>
          <p className="text-sm text-gray-500 mb-6">Create your first workspace to get started.</p>
          <form onSubmit={handleCreate} className="space-y-4">
            <input
              type="text"
              value={wsName}
              onChange={(e) => setWsName(e.target.value)}
              placeholder="Workspace name"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <button
              type="submit"
              disabled={creating || !wsName.trim()}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? 'Creating…' : 'Create workspace'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
