import { env } from './config/env';
import { initPool } from './shared/db';
import { logger } from './shared/logger';
import { createApp } from './app';

const app = createApp({
  corsOrigin: env.CORS_ORIGIN,
  jwtSecret: env.JWT_SECRET,
  jwtAccessExpiry: env.JWT_ACCESS_EXPIRY,
  jwtRefreshExpiry: env.JWT_REFRESH_EXPIRY,
  encryptionMasterKey: env.ENCRYPTION_MASTER_KEY,
});

initPool({ connectionString: env.DATABASE_URL });

app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT}`, {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
  });
});
