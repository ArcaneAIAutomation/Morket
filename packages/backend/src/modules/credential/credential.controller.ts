import { Request, Response, NextFunction } from 'express';
import * as credentialService from './credential.service';
import { successResponse } from '../../shared/envelope';

export function createCredentialController(encryptionMasterKey: string) {
  return {
    async store(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { providerName, key, secret } = req.body;
        const credential = await credentialService.store(
          req.params.id,
          providerName,
          key,
          secret,
          req.user!.userId,
          encryptionMasterKey,
        );
        res.status(201).json(successResponse(credential));
      } catch (err) {
        next(err);
      }
    },

    async list(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const credentials = await credentialService.list(req.params.id, encryptionMasterKey);
        res.status(200).json(successResponse(credentials));
      } catch (err) {
        next(err);
      }
    },

    async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await credentialService.deleteCredential(req.params.credId);
        res.status(200).json(successResponse({ message: 'Credential deleted' }));
      } catch (err) {
        next(err);
      }
    },
  };
}
