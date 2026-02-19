import { Request, Response, NextFunction } from 'express';
import * as creditService from './credit.service';
import { successResponse } from '../../shared/envelope';

export function createCreditController() {
  return {
    async getBilling(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const billing = await creditService.getBilling(req.params.id);
        res.status(200).json(successResponse(billing));
      } catch (err) {
        next(err);
      }
    },

    async addCredits(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { amount, description } = req.body;
        const transaction = await creditService.addCredits(req.params.id, amount, description);
        res.status(201).json(successResponse(transaction));
      } catch (err) {
        next(err);
      }
    },

    async getTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const page = req.query.page as unknown as number;
        const limit = req.query.limit as unknown as number;
        const result = await creditService.getTransactions(req.params.id, { page, limit });
        res.status(200).json(
          successResponse(result.items, {
            page: result.page,
            limit: result.limit,
            total: result.total,
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  };
}
