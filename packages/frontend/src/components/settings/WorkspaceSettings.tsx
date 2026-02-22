import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useUIStore } from '@/stores/ui.store';
import { useRole } from '@/hooks/useRole';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

export default function WorkspaceSettings() {
  const navigate = useNavigate();
  const { can } = useRole();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const addToast = useUIStore((s) => s.addToast);

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const [name, setName] = useState(workspace?.name ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  if (!workspace || !activeWorkspaceId) {
    return <p className="text-gray-500 text-sm">No workspace selected.</p>;
  }

  const handleSaveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === workspace.name) return;
    setIsSaving(true);
    try {
      await updateWorkspace(activeWorkspaceId, trimmed);
      addToast('success', 'Workspace name updated.');
    } catch {
      addToast('error', 'Failed to update workspace name.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setShowDeleteDialog(false);
    try {
      await deleteWorkspace(activeWorkspaceId);
      addToast('success', 'Workspace deleted.');
      navigate('/workspaces');
    } catch {
      addToast('error', 'Failed to delete workspace.');
    }
  };

  return (
    <div className="max-w-lg space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-4">Workspace Settings</h2>

        <label htmlFor="ws-name" className="block text-sm font-medium text-gray-700 mb-1">
          Workspace Name
        </label>
        <div className="flex gap-3">
          <input
            id="ws-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!can('edit_workspace')}
            className="flex-1 border rounded px-3 py-2 text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          {can('edit_workspace') && (
            <button
              onClick={handleSaveName}
              disabled={isSaving || name.trim() === workspace.name || !name.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </section>

      {can('delete_workspace') && (
        <section className="border-t pt-6">
          <h3 className="text-sm font-semibold text-red-600 mb-2">Danger Zone</h3>
          <p className="text-sm text-gray-600 mb-3">
            Deleting a workspace is permanent and cannot be undone. All data will be lost.
          </p>
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
          >
            Delete Workspace
          </button>
        </section>
      )}

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete Workspace"
        message={`This will permanently delete "${workspace.name}" and all its data. Type the workspace name to confirm.`}
        confirmLabel="Delete"
        confirmText={workspace.name}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </div>
  );
}
