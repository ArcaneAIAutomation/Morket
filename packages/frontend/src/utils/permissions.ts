import type { WorkspaceRole } from '@/types/api.types';

export const ROLE_PERMISSIONS: Record<WorkspaceRole, Set<string>> = {
  viewer: new Set(['view_records', 'export_csv']),
  member: new Set([
    'view_records', 'export_csv',
    'edit_records', 'add_records', 'delete_records',
    'import_csv', 'run_enrichment',
    'manage_columns',
  ]),
  admin: new Set([
    'view_records', 'export_csv',
    'edit_records', 'add_records', 'delete_records',
    'import_csv', 'run_enrichment',
    'manage_columns',
    'manage_credentials', 'manage_members',
    'edit_workspace',
  ]),
  owner: new Set([
    'view_records', 'export_csv',
    'edit_records', 'add_records', 'delete_records',
    'import_csv', 'run_enrichment',
    'manage_columns',
    'manage_credentials', 'manage_members',
    'edit_workspace',
    'delete_workspace', 'manage_billing',
  ]),
};

export function hasPermission(role: WorkspaceRole | null, action: string): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(action) ?? false;
}
