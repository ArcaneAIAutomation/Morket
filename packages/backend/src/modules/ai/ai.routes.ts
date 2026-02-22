import { Router } from 'express';
import { createAiController } from './ai.controller';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import {
  workspaceParamsSchema,
  recordParamsSchema,
  fieldMappingSuggestBodySchema,
  duplicateDetectBodySchema,
  nlQueryBodySchema,
} from './ai.schemas';

export function createAiRoutes(): Router {
  const controller = createAiController();
  const router = Router({ mergeParams: true });

  // Quality scoring
  router.post(
    '/quality/compute',
    validate({ params: workspaceParamsSchema }),
    requireRole('member'),
    controller.computeQuality,
  );

  router.get(
    '/quality/summary',
    validate({ params: workspaceParamsSchema }),
    requireRole('member'),
    controller.qualitySummary,
  );

  router.get(
    '/quality/:recordId',
    validate({ params: recordParamsSchema }),
    requireRole('member'),
    controller.recordQuality,
  );

  // Field mapping suggestions
  router.post(
    '/field-mapping/suggest',
    validate({ params: workspaceParamsSchema, body: fieldMappingSuggestBodySchema }),
    requireRole('member'),
    controller.suggestFieldMappings,
  );

  // Duplicate detection
  router.post(
    '/duplicates/detect',
    validate({ params: workspaceParamsSchema, body: duplicateDetectBodySchema }),
    requireRole('member'),
    controller.detectDuplicates,
  );

  // Natural language query
  router.post(
    '/query',
    validate({ params: workspaceParamsSchema, body: nlQueryBodySchema }),
    requireRole('member'),
    controller.nlQuery,
  );

  return router;
}
