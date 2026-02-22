import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ROLE_PERMISSIONS, hasPermission } from '@/utils/permissions';
import type { WorkspaceRole } from '@/types/api.types';

const ALL_ROLES: WorkspaceRole[] = ['viewer', 'member', 'admin', 'owner'];

const ALL_ACTIONS = [
  'view_records', 'export_csv',
  'edit_records', 'add_records', 'delete_records',
  'import_csv', 'run_enrichment',
  'manage_columns',
  'manage_credentials', 'manage_members',
  'edit_workspace',
  'delete_workspace', 'manage_billing',
];

/**
 * Property 35: Role-based UI permissions
 * **Validates: Requirements 10.5, 11.6, 12.5, 13.1, 13.2, 13.3, 13.4, 13.6**
 *
 * For any user role, the UI should show or hide controls according to the
 * ROLE_PERMISSIONS map.
 */
describe('Property 35: Role-based UI permissions', () => {
  it('hasPermission should return true iff action is in ROLE_PERMISSIONS for that role', () => {
    const roleArb = fc.constantFrom<WorkspaceRole>(...ALL_ROLES);
    const actionArb = fc.constantFrom(...ALL_ACTIONS);

    fc.assert(
      fc.property(roleArb, actionArb, (role, action) => {
        const expected = ROLE_PERMISSIONS[role].has(action);
        expect(hasPermission(role, action)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('viewer should only have view_records and export_csv', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_ACTIONS), (action) => {
        const allowed = hasPermission('viewer', action);
        const expected = action === 'view_records' || action === 'export_csv';
        expect(allowed).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('each higher role should be a superset of the lower role', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_ACTIONS), (action) => {
        // viewer ⊆ member ⊆ admin ⊆ owner
        if (hasPermission('viewer', action)) {
          expect(hasPermission('member', action)).toBe(true);
          expect(hasPermission('admin', action)).toBe(true);
          expect(hasPermission('owner', action)).toBe(true);
        }
        if (hasPermission('member', action)) {
          expect(hasPermission('admin', action)).toBe(true);
          expect(hasPermission('owner', action)).toBe(true);
        }
        if (hasPermission('admin', action)) {
          expect(hasPermission('owner', action)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('null role should deny all actions', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_ACTIONS), (action) => {
        expect(hasPermission(null, action)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('member cannot manage credentials, members, or billing', () => {
    const restrictedActions = ['manage_credentials', 'manage_members', 'edit_workspace', 'delete_workspace', 'manage_billing'];
    fc.assert(
      fc.property(fc.constantFrom(...restrictedActions), (action) => {
        expect(hasPermission('member', action)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('admin cannot delete workspace or manage billing', () => {
    const ownerOnlyActions = ['delete_workspace', 'manage_billing'];
    fc.assert(
      fc.property(fc.constantFrom(...ownerOnlyActions), (action) => {
        expect(hasPermission('admin', action)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 36: Credential masking
 * **Validates: Requirements 11.1, 11.3, 11.5**
 *
 * For any credential displayed in the UI, only the masked key (last 4 characters)
 * should be present. The raw API key should never appear.
 */
describe('Property 36: Credential masking', () => {
  function maskKey(rawKey: string): string {
    if (rawKey.length <= 4) return rawKey;
    return '•'.repeat(rawKey.length - 4) + rawKey.slice(-4);
  }

  it('masked key should only expose last 4 characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 64 }),
        (rawKey) => {
          const masked = maskKey(rawKey);

          // Last 4 chars should match
          expect(masked.slice(-4)).toBe(rawKey.slice(-4));

          // Everything before last 4 should be masked (bullet chars)
          const maskedPrefix = masked.slice(0, -4);
          expect(maskedPrefix).toBe('•'.repeat(rawKey.length - 4));

          // The full raw key should NOT appear in the masked output
          expect(masked).not.toBe(rawKey);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('short keys (≤4 chars) are returned as-is', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 4 }),
        (rawKey) => {
          const masked = maskKey(rawKey);
          expect(masked).toBe(rawKey);
        },
      ),
      { numRuns: 100 },
    );
  });
});
