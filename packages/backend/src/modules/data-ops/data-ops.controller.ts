import { Request, Response, NextFunction } from 'express';
import * as dataOpsService from './data-ops.service';
import { successResponse } from '../../shared/envelope';
import { ValidationError } from '../../shared/errors';

export function createDataOpsController() {
  return {
    async importPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const file = req.file;
        if (!file) throw new ValidationError('CSV file is required');
        const csvContent = file.buffer.toString('utf-8');
        const result = dataOpsService.previewImport(req.params.id, csvContent);
        res.status(200).json(successResponse(result));
      } catch (err) {
        next(err);
      }
    },

    async importCommit(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { sessionId } = req.body;
        const session = dataOpsService.getImportSession(sessionId, req.params.id);
        // Return the session data for the caller to process
        // In a full implementation, this would insert into enrichment_records in batches
        const result = { imported: session.validRows, headers: session.headers };
        dataOpsService.clearImportSession(sessionId);
        res.status(200).json(successResponse(result));
      } catch (err) {
        next(err);
      }
    },

    async exportRecords(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { format, filters, limit } = req.body;
        const result = await dataOpsService.exportRecords(req.params.id, format, filters ?? {}, limit);
        res.setHeader('Content-Type', result.contentType);
        if (format === 'csv') {
          res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
        }
        res.status(200).send(result.data);
      } catch (err) {
        next(err);
      }
    },

    async dedupScan(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { keyFields } = req.body;
        const groups = await dataOpsService.scanDuplicates(req.params.id, keyFields);
        res.status(200).json(successResponse(groups));
      } catch (err) {
        next(err);
      }
    },

    async dedupMerge(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { groups, strategy } = req.body;
        const userId = (req as unknown as { user?: { id: string } }).user?.id;
        const result = await dataOpsService.mergeDuplicates(req.params.id, groups, strategy, userId);
        res.status(200).json(successResponse(result));
      } catch (err) {
        next(err);
      }
    },

    async hygiene(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const stats = await dataOpsService.getHygieneStats(req.params.id);
        res.status(200).json(successResponse(stats));
      } catch (err) {
        next(err);
      }
    },

    async bulkDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { recordIds } = req.body;
        const userId = (req as unknown as { user?: { id: string } }).user?.id;
        const result = await dataOpsService.bulkDelete(req.params.id, recordIds, userId);
        res.status(200).json(successResponse(result));
      } catch (err) {
        next(err);
      }
    },

    async bulkReEnrich(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        // Placeholder — full implementation would create an enrichment job via enrichment service
        res.status(501).json(successResponse({ message: 'Bulk re-enrich requires enrichment job integration' }));
      } catch (err) {
        next(err);
      }
    },

    async listViews(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const views = await dataOpsService.listViews(req.params.id);
        res.status(200).json(successResponse(views));
      } catch (err) {
        next(err);
      }
    },

    async createView(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const userId = (req as unknown as { user?: { id: string } }).user?.id ?? '';
        const view = await dataOpsService.createView(req.params.id, userId, req.body);
        res.status(201).json(successResponse(view));
      } catch (err) {
        next(err);
      }
    },

    async updateView(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const view = await dataOpsService.updateView(req.params.id, req.params.viewId, req.body);
        res.status(200).json(successResponse(view));
      } catch (err) {
        next(err);
      }
    },

    async deleteView(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await dataOpsService.deleteView(req.params.id, req.params.viewId);
        res.status(200).json(successResponse({ deleted: true }));
      } catch (err) {
        next(err);
      }
    },

    async activityLog(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const result = await dataOpsService.getActivityLog(req.params.recordId, page, limit);
        res.status(200).json(successResponse(result.entries, { page, limit, total: result.total }));
      } catch (err) {
        next(err);
      }
    },
  };
}
