import { Router } from 'express';
import { AuthConfig } from './auth.service';
import { createAuthController } from './auth.controller';
import { validate } from '../../middleware/validate';
import { registerSchema, loginSchema, refreshSchema } from './auth.schemas';
import { authRateLimiter } from '../../middleware/rateLimiter';

export function createAuthRoutes(config: AuthConfig): Router {
  const router = Router();
  const controller = createAuthController(config);

  router.use(authRateLimiter);

  router.post('/register', validate({ body: registerSchema }), controller.register);
  router.post('/login', validate({ body: loginSchema }), controller.login);
  router.post('/refresh', validate({ body: refreshSchema }), controller.refresh);
  router.post('/logout', controller.logout);

  return router;
}
