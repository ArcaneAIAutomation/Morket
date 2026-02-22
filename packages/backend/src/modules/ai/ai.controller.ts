import { Request, Response, NextFunction } from 'express';
import * as aiService from './ai.service';
import { successResponse } from '../../shared/envelope';

export function createAiController() {
  return {
    async computeQuality(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const result = await aiService.computeQualityScores(req.params.id);
        res.status(202).json(successResponse(result));
      } catch (err) { next(err); }
    },

    async qualitySummary(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const summary = await aiService.getQualitySummary(req.params.id);
        res.status(200).json(successResponse(summary));
      } catch (err) { next(err); }
    },

    async recordQuality(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const score = await aiService.getRecordQuality(req.params.id, req.params.recordId);
        res.status(200).json(successResponse(score));
      } catch (err) { next(err); }
    },

    async suggestFieldMappings(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const suggestions = aiService.suggestMappings(req.body.headers);
        res.status(200).json(successResponse(suggestions));
      } catch (err) { next(err); }
    },

    async detectDuplicates(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { fields, threshold, limit } = req.body;
        const pairs = await aiService.detectDuplicates(req.params.id, fields, threshold, limit);
        res.status(200).json(successResponse(pairs));
      } catch (err) { next(err); }
    },

    async nlQuery(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const result = aiService.parseNaturalLanguageQuery(req.body.query);
        res.status(200).json(successResponse(result));
      } catch (err) { next(err); }
    },
  };
}
