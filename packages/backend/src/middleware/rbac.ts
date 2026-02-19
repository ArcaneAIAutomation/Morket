import { Request, Response, NextFunction } from 'express';
import { AuthenticationError, AuthorizationError } from '../shared/errors';
import { query } from '../shared/db';
import type { WorkspaceRole } from '../shared/types';

export type { WorkspaceRole };

export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function requireRole(minimumRole: WorkspaceRole) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const workspaceId = req.params.id;

      const result = await query<{ role: WorkspaceRole }>(
        'SELECT role FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2',
        [req.user.userId, workspaceId],
      );

      if (result.rows.length === 0) {
        throw new AuthorizationError('Not a member of this workspace');
      }

      const userRole = result.rows[0].role;

      if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[minimumRole]) {
        throw new AuthorizationError('Insufficient permissions');
      }

      req.user.role = userRole;
      req.user.workspaceId = workspaceId;
      next();
    } catch (err) {
      next(err);
    }
  };
}
