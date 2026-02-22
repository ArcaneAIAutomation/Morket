import { Router } from 'express';
import multer from 'multer';
import { createDataOpsController } from './data-ops.controller';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import {
  workspaceParamsSchema,
  viewParamsSchema,
  importCommitBodySchema,
  exportBodySchema,
  dedupScanBodySchema,
  dedupMergeBodySchema,
  bulkDeleteBodySchema,
  bulkReEnrichBodySchema,
  createViewBodySchema,
  updateViewBodySchema,
  activityParamsSchema,
  activityQuerySchema,
} from './data-ops.schemas';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

export function createDataOpsRoutes(): Router {
  const controller = createDataOpsController();
  const router = Router({ mergeParams: true });

  // --- Import ---
  router.post(
    '/import/preview',
    validate({ params: workspaceParamsSchema }),
    requireRole('owner'),
    upload.single('file'),
    controller.importPreview,
  );

  router.post(
    '/import/commit',
    validate({ params: workspaceParamsSchema, body: importCommitBodySchema }),
    requireRole('owner'),
    controller.importCommit,
  );

  // --- Export ---
  router.post(
    '/export',
    validate({ params: workspaceParamsSchema, body: exportBodySchema }),
    requireRole('member'),
    controller.exportRecords,
  );

  // --- Dedup ---
  router.post(
    '/dedup/scan',
    validate({ params: workspaceParamsSchema, body: dedupScanBodySchema }),
    requireRole('owner'),
    controller.dedupScan,
  );

  router.post(
    '/dedup/merge',
    validate({ params: workspaceParamsSchema, body: dedupMergeBodySchema }),
    requireRole('owner'),
    controller.dedupMerge,
  );

  // --- Hygiene ---
  router.get(
    '/hygiene',
    validate({ params: workspaceParamsSchema }),
    requireRole('member'),
    controller.hygiene,
  );

  // --- Bulk Ops ---
  router.post(
    '/bulk/delete',
    validate({ params: workspaceParamsSchema, body: bulkDeleteBodySchema }),
    requireRole('owner'),
    controller.bulkDelete,
  );

  router.post(
    '/bulk/re-enrich',
    validate({ params: workspaceParamsSchema, body: bulkReEnrichBodySchema }),
    requireRole('owner'),
    controller.bulkReEnrich,
  );

  // --- Saved Views ---
  router.get(
    '/views',
    validate({ params: workspaceParamsSchema }),
    requireRole('member'),
    controller.listViews,
  );

  router.post(
    '/views',
    validate({ params: workspaceParamsSchema, body: createViewBodySchema }),
    requireRole('member'),
    controller.createView,
  );

  router.put(
    '/views/:viewId',
    validate({ params: viewParamsSchema, body: updateViewBodySchema }),
    requireRole('member'),
    controller.updateView,
  );

  router.delete(
    '/views/:viewId',
    validate({ params: viewParamsSchema }),
    requireRole('member'),
    controller.deleteView,
  );

  // --- Activity Log ---
  router.get(
    '/activity/:recordId',
    validate({ params: activityParamsSchema, query: activityQuerySchema }),
    requireRole('member'),
    controller.activityLog,
  );

  return router;
}
