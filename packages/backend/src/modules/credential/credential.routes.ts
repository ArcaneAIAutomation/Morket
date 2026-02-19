import { Router } from 'express';
import { createCredentialController } from './credential.controller';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import {
  storeCredentialSchema,
  workspaceParamsSchema,
  credentialParamsSchema,
} from './credential.schemas';

export function createCredentialRoutes(encryptionMasterKey: string): Router {
  const router = Router({ mergeParams: true });
  const controller = createCredentialController(encryptionMasterKey);

  // POST /api/v1/workspaces/:id/credentials  (admin+)
  router.post(
    '/',
    validate({ params: workspaceParamsSchema, body: storeCredentialSchema }),
    requireRole('admin'),
    controller.store,
  );

  // GET /api/v1/workspaces/:id/credentials  (member+)
  router.get(
    '/',
    validate({ params: workspaceParamsSchema }),
    requireRole('member'),
    controller.list,
  );

  // DELETE /api/v1/workspaces/:id/credentials/:credId  (admin+)
  router.delete(
    '/:credId',
    validate({ params: credentialParamsSchema }),
    requireRole('admin'),
    controller.remove,
  );

  return router;
}
