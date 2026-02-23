import { Request, Response, NextFunction } from 'express';
import { AuthenticationError, AuthorizationError } from '../shared/errors';
import { query } from '../shared/db';
import { logAuthzFailure } from '../observability/logger';
import type { WorkspaceRole } from '../shared/types';

export type { WorkspaceRole };

export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  viewer: 0,
  billing_admin: 1,
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * Set of path segments that billing_admin is allowed to access.
 * Any workspace-scoped route containing one of these segments is considered a billing endpoint.
 */
const BILLING_PATH_SEGMENTS = new Set(['billing', 'invoices', 'checkout', 'portal', 'credits']);

/**
 * Checks whether the current request path is a billing-related endpoint.
 */
function isBillingEndpoint(req: Request): boolean {
  const pathSegments = req.baseUrl.split('/').concat(req.path.split('/'));
  return pathSegments.some((segment) => BILLING_PATH_SEGMENTS.has(segment));
}

/**
 * Extracts the workspace ID from the request URL parameters.
 * Supports both `req.params.id` and `req.params.workspaceId`.
 */
function getWorkspaceIdFromParams(req: Request): string | undefined {
  return req.params.id || req.params.workspaceId;
}

export function requireRole(minimumRole: WorkspaceRole) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const workspaceId = getWorkspaceIdFromParams(req);

      // Workspace ID cross-check: if the user already has a workspaceId from the JWT,
      // verify it matches the URL parameter
      if (workspaceId && req.user.workspaceId && req.user.workspaceId !== workspaceId) {
        throw new AuthorizationError('Workspace ID mismatch');
      }

      const result = await query<{ role: WorkspaceRole }>(
        'SELECT role FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2',
        [req.user.userId, workspaceId],
      );

      if (result.rows.length === 0) {
        throw new AuthorizationError('Not a member of this workspace');
      }

      const userRole = result.rows[0].role;

      // billing_admin restriction: can only access billing-related endpoints
      if (userRole === 'billing_admin' && !isBillingEndpoint(req)) {
        logAuthzFailure({
          userId: req.user?.userId || 'unknown',
          resource: req.originalUrl,
          requiredRole: minimumRole,
          actualRole: userRole,
        });
        throw new AuthorizationError('billing_admin role is restricted to billing endpoints');
      }

      // For billing_admin accessing billing endpoints, skip the normal hierarchy check
      // since billing_admin is a special role that doesn't fit the standard hierarchy
      if (userRole === 'billing_admin' && isBillingEndpoint(req)) {
        req.user.role = userRole;
        req.user.workspaceId = workspaceId;
        return next();
      }

      if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[minimumRole]) {
        logAuthzFailure({
          userId: req.user?.userId || 'unknown',
          resource: req.originalUrl,
          requiredRole: minimumRole,
          actualRole: userRole,
        });
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


/**
 * Middleware factory for resource-level (object-level) authorization.
 * Verifies that the requested resource belongs to the authenticated user's workspace.
 *
 * @param getResourceWorkspaceId - An async function that extracts the workspace ID
 *   that owns the resource, given the request. Returns null if the resource is not found.
 */
export function requireObjectOwnership(
  getResourceWorkspaceId: (req: Request) => Promise<string | null>,
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const userWorkspaceId = req.user.workspaceId || getWorkspaceIdFromParams(req);
      if (!userWorkspaceId) {
        throw new AuthorizationError('Workspace context required');
      }

      const resourceWorkspaceId = await getResourceWorkspaceId(req);
      if (!resourceWorkspaceId) {
        throw new AuthorizationError('Resource not found or access denied');
      }

      if (resourceWorkspaceId !== userWorkspaceId) {
        throw new AuthorizationError('Resource does not belong to your workspace');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
