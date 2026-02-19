import { Router } from 'express';
import { createWorkspaceController } from './workspace.controller';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  addMemberSchema,
  updateRoleSchema,
  workspaceParamsSchema,
  memberParamsSchema,
} from './workspace.schemas';

export function createWorkspaceRoutes(): Router {
  const router = Router();
  const controller = createWorkspaceController();

  // POST /  (authenticated — any authenticated user can create)
  router.post('/', validate({ body: createWorkspaceSchema }), controller.create);

  // GET /  (authenticated — returns only user's workspaces)
  router.get('/', controller.list);

  // GET /:id  (member+)
  router.get(
    '/:id',
    validate({ params: workspaceParamsSchema }),
    requireRole('member'),
    controller.getById,
  );

  // PUT /:id  (admin+)
  router.put(
    '/:id',
    validate({ params: workspaceParamsSchema, body: updateWorkspaceSchema }),
    requireRole('admin'),
    controller.update,
  );

  // DELETE /:id  (owner)
  router.delete(
    '/:id',
    validate({ params: workspaceParamsSchema }),
    requireRole('owner'),
    controller.delete,
  );

  // POST /:id/members  (admin+)
  router.post(
    '/:id/members',
    validate({ params: workspaceParamsSchema, body: addMemberSchema }),
    requireRole('admin'),
    controller.addMember,
  );

  // DELETE /:id/members/:userId  (admin+)
  router.delete(
    '/:id/members/:userId',
    validate({ params: memberParamsSchema }),
    requireRole('admin'),
    controller.removeMember,
  );

  // PUT /:id/members/:userId/role  (admin+)
  router.put(
    '/:id/members/:userId/role',
    validate({ params: memberParamsSchema, body: updateRoleSchema }),
    requireRole('admin'),
    controller.updateMemberRole,
  );

  return router;
}
