import { useWorkspaceStore } from '@/stores/workspace.store';
import { hasPermission } from '@/utils/permissions';

export function useRole() {
  const currentRole = useWorkspaceStore((s) => s.currentRole);
  return {
    role: currentRole,
    can: (action: string) => hasPermission(currentRole, action),
  };
}
