import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useUIStore } from '@/stores/ui.store';
import { useRole } from '@/hooks/useRole';
import { formatDate } from '@/utils/formatters';
import { getCredentials, createCredential, deleteCredential } from '@/api/credentials.api';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import type { Credential } from '@/types/api.types';

const PROVIDERS = ['apollo', 'clearbit', 'hunter', 'scraper'];

export default function CredentialSettings() {
  const { can } = useRole();
  const canManage = can('manage_credentials');

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const addToast = useUIStore((s) => s.addToast);

  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Form state — raw key/secret only held transiently for submission, never stored after
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Credential | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setIsLoading(true);
    getCredentials(activeWorkspaceId)
      .then(setCredentials)
      .catch(() => addToast('error', 'Failed to load credentials.'))
      .finally(() => setIsLoading(false));
  }, [activeWorkspaceId, addToast]);

  if (!activeWorkspaceId) {
    return <p className="text-gray-500 text-sm">No workspace selected.</p>;
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setIsAdding(true);
    try {
      const cred = await createCredential(activeWorkspaceId, {
        providerName: provider,
        apiKey: apiKey.trim(),
        ...(apiSecret.trim() ? { apiSecret: apiSecret.trim() } : {}),
      });
      // Only store the masked credential returned by the backend — never the raw key
      setCredentials((prev) => [...prev, cred]);
      setApiKey('');
      setApiSecret('');
      addToast('success', 'Credential stored.');
    } catch {
      addToast('error', 'Failed to add credential.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCredential(activeWorkspaceId, deleteTarget.id);
      setCredentials((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      addToast('success', 'Credential deleted.');
    } catch {
      addToast('error', 'Failed to delete credential.');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <h2 className="text-lg font-semibold">API Credentials</h2>

      {canManage && (
        <form onSubmit={handleAdd} className="space-y-3 border rounded-lg p-4 bg-gray-50">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="cred-provider" className="block text-sm font-medium text-gray-700 mb-1">
                Provider
              </label>
              <select
                id="cred-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cred-key" className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <input
                id="cred-key"
                type="password"
                required
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter API key"
                className="w-full border rounded px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="cred-secret" className="block text-sm font-medium text-gray-700 mb-1">
                API Secret
              </label>
              <input
                id="cred-secret"
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Optional"
                className="w-full border rounded px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isAdding || !apiKey.trim()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAdding ? 'Adding…' : 'Add Credential'}
          </button>
        </form>
      )}

      {isLoading ? (
        <p className="text-gray-400 text-sm">Loading credentials…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Provider</th>
                <th className="py-2 pr-4 font-medium">Masked Key</th>
                <th className="py-2 pr-4 font-medium">Created</th>
                {canManage && <th className="py-2 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {credentials.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 capitalize">{c.providerName}</td>
                  <td className="py-2 pr-4 font-mono text-gray-500">****{c.maskedKey}</td>
                  <td className="py-2 pr-4 text-gray-500">{formatDate(c.createdAt)}</td>
                  {canManage && (
                    <td className="py-2">
                      <button
                        onClick={() => setDeleteTarget(c)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {credentials.length === 0 && (
            <p className="text-gray-400 text-sm py-4 text-center">No credentials stored.</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Credential"
        message={`Delete the ${deleteTarget?.providerName ?? ''} credential (****${deleteTarget?.maskedKey ?? ''})? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
