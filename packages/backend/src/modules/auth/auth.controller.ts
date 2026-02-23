import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { AuthConfig } from './auth.service';
import { successResponse } from '../../shared/envelope';

export interface AuthController {
  register(req: Request, res: Response, next: NextFunction): Promise<void>;
  login(req: Request, res: Response, next: NextFunction): Promise<void>;
  refresh(req: Request, res: Response, next: NextFunction): Promise<void>;
  logout(req: Request, res: Response, next: NextFunction): Promise<void>;
  changePassword(req: Request, res: Response, next: NextFunction): Promise<void>;
}

export function createAuthController(config: AuthConfig): AuthController {
  return {
    async register(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { email, password, name } = req.body;
        const user = await authService.register(email, password, name, config);
        const { passwordHash, ...safeUser } = user;
        res.status(201).json(successResponse(safeUser));
      } catch (err) {
        next(err);
      }
    },

    async login(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { email, password } = req.body;
        const tokens = await authService.login(email, password, config);
        res.status(200).json(successResponse(tokens));
      } catch (err) {
        next(err);
      }
    },

    async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { refreshToken } = req.body;
        const tokens = await authService.refresh(refreshToken, config);
        res.status(200).json(successResponse(tokens));
      } catch (err) {
        next(err);
      }
    },

    async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { refreshToken } = req.body;
        await authService.logout(refreshToken);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },

    async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const userId = (req as any).user?.userId;
        const { oldPassword, newPassword } = req.body;
        await authService.changePassword(userId, oldPassword, newPassword, config);
        res.status(200).json(successResponse({ message: 'Password changed' }));
      } catch (err) {
        next(err);
      }
    },
  };
}
