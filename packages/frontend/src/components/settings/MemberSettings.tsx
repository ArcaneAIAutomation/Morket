import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useUIStore } from '@/stores/ui.store';
import { useRole } from '@/hooks/useRole';
import { formatDate } from '@/utils/formatters';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import type { WorkspaceRole } from '@/types/api.types';

const ASSIGNABLE_ROLES: WorkspaceRole[] = ['viewer', 'member', 'admin', 'owner'];

export default function MemberSettings() {
  const { can } = useRole();
  const canManage = can('manage_members');

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const members = useWorkspaceStore((s) => s.members);
  const fetchMembers = useWorkspaceStore((s) => s.fetchMembers);
  const inviteMember = useWorkspaceStore((s) => s.inviteMember);
  const updateMemberRole = useWorkspaceStore((s) => s.updateMemberRole);
  const removeMember = useWorkspaceStore((s) => s.removeMember);
  const addToast = useUIStore((s) => s.addToast);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('member');
  const [isInviting, setIsInviting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; name: string } | null>(null);

  useEffect(() => {
    if (activeWorkspaceId) {
      fetchMembers(activeWorkspaceId).catch(() =>
        addToast('error', 'Failed to load members.'),
      );
    }
  }, [activeWorkspaceId, fetchMembers, addToast]);

  if (!activeWorkspaceId) {
    return <p className="text-gray-500 text-sm">No workspace selected.</p>;
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setIsInviting(true);
    try {
      await inviteMember(activeWorkspaceId, trimmed, role);
      addToast('success', `Invited ${trimmed}.`);
      setEmail('');
      setRole('member');
    } catch {
      addToast('error', 'Failed to invite member.');
    } finally {
      setIsInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: WorkspaceRole) => {
    try {
      await updateMemberRole(activeWorkspaceId, userId, newRole);
      addToast('success', 'Role updated.');
    } catch {
      addToast('error', 'Failed to update role.');
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      await removeMember(activeWorkspaceId, removeTarget.userId);
      addToast('success', `Removed ${removeTarget.name}.`);
    } catch {
      addToast('error', 'Failed to remove member. A workspace must have at least one owner.');
    } finally {
      setRemoveTarget(null);
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <h2 className="text-lg font-semibold">Members</h2>

      {canManage && (
        <form onSubmit={handleInvite} className="flex gap-3 items-end">
          <div className="flex-1">
            <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
              className="border rounded px-3 py-2 text-sm"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={isInviting || !email.trim()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isInviting ? 'Inviting…' : 'Invite'}
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="py-2 pr-4 font-medium">Joined</th>
              {canManage && <th className="py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-b last:border-0">
                <td className="py-2 pr-4">{m.displayName}</td>
                <td className="py-2 pr-4 text-gray-500">{m.email}</td>
                <td className="py-2 pr-4">
                  {canManage ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.userId, e.target.value as WorkspaceRole)}
                      className="border rounded px-2 py-1 text-sm"
                      aria-label={`Role for ${m.displayName}`}
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="capitalize">{m.role}</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-gray-500">{formatDate(m.joinedAt)}</td>
                {canManage && (
                  <td className="py-2">
                    <button
                      onClick={() => setRemoveTarget({ userId: m.userId, name: m.displayName })}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {members.length === 0 && (
          <p className="text-gray-400 text-sm py-4 text-center">No members yet.</p>
        )}
      </div>

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove Member"
        message={`Are you sure you want to remove ${removeTarget?.name ?? 'this member'} from the workspace?`}
        confirmLabel="Remove"
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
