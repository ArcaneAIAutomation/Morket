import { Router } from 'express';
import { createWorkflowController } from './workflow.controller';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import {
  workspaceParamsSchema,
  workflowParamsSchema,
  runParamsSchema,
  templateParamsSchema,
  createWorkflowBodySchema,
  updateWorkflowBodySchema,
  rollbackBodySchema,
  scheduleBodySchema,
  listRunsQuerySchema,
} from './workflow.schemas';

export function createWorkflowRoutes(): Router {
  const controller = createWorkflowController();
  const router = Router({ mergeParams: true });

  // Templates (before :workflowId routes to avoid conflict)
  router.get(
    '/templates',
    validate({ params: workspaceParamsSchema }),
    requireRole('member'),
    controller.listTemplates,
  );

  router.post(
    '/templates/:templateId/clone',
    validate({ params: templateParamsSchema }),
    requireRole('owner'),
    controller.cloneTemplate,
  );

  // CRUD
  router.get(
    '/',
    validate({ params: workspaceParamsSchema }),
    requireRole('member'),
    controller.list,
  );

  router.post(
    '/',
    validate({ params: workspaceParamsSchema, body: createWorkflowBodySchema }),
    requireRole('owner'),
    controller.create,
  );

  router.get(
    '/:workflowId',
    validate({ params: workflowParamsSchema }),
    requireRole('member'),
    controller.get,
  );

  router.put(
    '/:workflowId',
    validate({ params: workflowParamsSchema, body: updateWorkflowBodySchema }),
    requireRole('owner'),
    controller.update,
  );

  router.delete(
    '/:workflowId',
    validate({ params: workflowParamsSchema }),
    requireRole('owner'),
    controller.delete,
  );

  // Versions
  router.get(
    '/:workflowId/versions',
    validate({ params: workflowParamsSchema }),
    requireRole('member'),
    controller.listVersions,
  );

  router.post(
    '/:workflowId/rollback',
    validate({ params: workflowParamsSchema, body: rollbackBodySchema }),
    requireRole('owner'),
    controller.rollback,
  );

  // Execution
  router.post(
    '/:workflowId/execute',
    validate({ params: workflowParamsSchema }),
    requireRole('member'),
    controller.execute,
  );

  router.get(
    '/:workflowId/runs',
    validate({ params: workflowParamsSchema, query: listRunsQuerySchema }),
    requireRole('member'),
    controller.listRuns,
  );

  router.get(
    '/:workflowId/runs/:runId',
    validate({ params: runParamsSchema }),
    requireRole('member'),
    controller.getRun,
  );

  // Schedule
  router.put(
    '/:workflowId/schedule',
    validate({ params: workflowParamsSchema, body: scheduleBodySchema }),
    requireRole('owner'),
    controller.updateSchedule,
  );

  return router;
}
